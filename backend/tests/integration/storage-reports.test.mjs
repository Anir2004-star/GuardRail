import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { before, after, test } from "node:test";
const database = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test"); assert.match(database ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL).pathname, `/${database}`); assert.notEqual(database, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { createAccessToken } = await import("../../dist/auth/access-tokens.js");
const { registerVerifiedUser } = await import("../helpers/verified-user.mjs");
const { registerDevice } = await import("../../dist/services/device.service.js");
const { startDevicePairing, claimDevicePairing, decideDevicePairing, exchangeDevicePairing, disconnectDevice } = await import("../../dist/services/device-pairing.service.js");
const { pairingHash } = await import("../../dist/auth/device-pairing.js");
let owner, other, token, otherToken, server, base;
before(async () => {
  const account = () => registerVerifiedUser({ firstName: "Capacity", lastName: "Owner", email: `capacity-${randomUUID()}@example.invalid`, password: "Capacity test!12345" });
  owner = await account(); other = await account(); token = (await createAccessToken(owner.id)).accessToken; otherToken = (await createAccessToken(other.id)).accessToken;
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await disconnectDatabase(); });
const device = () => registerDevice(owner.id, { requestId: randomUUID(), name: "Capacity laptop", type: "Laptop" });
async function pair(record) {
  const start = await startDevicePairing(owner.id, record.id, {});
  const claim = await claimDevicePairing({ code: start.code, appName: "Capacity companion", platform: "Windows" });
  const row = await prisma.devicePairingSession.findUnique({ where: { id: claim.pairingId } });
  await decideDevicePairing(owner.id, record.id, row.id, "approve", { claimId: row.claimId });
  return exchangeDevicePairing(pairingHash("claim", claim.claimToken), {});
}
const report = (collectedAt = new Date()) => ({ reportId: randomUUID(), collectedAt: collectedAt.toISOString(), volumes: [{ id: "C:\\", totalBytes: 512 * 1024 ** 3, freeBytes: 128 * 1024 ** 3 }, { id: "D:\\", totalBytes: 256 * 1024 ** 3, freeBytes: 100 * 1024 ** 3 }] });
const send = (body, credential, origin) => fetch(`${base}/api/v1/companion/storage-reports`, { method: "POST", headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Device ${credential}` } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
const get = (id, bearer = token) => fetch(`${base}/api/v1/devices/${id}`, { headers: { Authorization: `Bearer ${bearer}` } });

test("only a current device credential can submit strict bounded capacity reports", async () => {
  const record = await device(); const issued = await pair(record);
  assert.equal((await send(report())).status, 401);
  assert.equal((await send(report(), token)).status, 401);
  assert.equal((await send(report(), issued.deviceToken, "https://wrong.invalid")).status, 403);
  const invalid = await send({ ...report(), ownerId: "PRIVATE_OWNER" }, issued.deviceToken); assert.equal(invalid.status, 400); assert.ok(!(await invalid.text()).includes("PRIVATE_OWNER"));
  assert.equal(await prisma.deviceStorageReport.count({ where: { deviceId: record.id } }), 0);
});
test("reports expose only owner-scoped capacity, derive usage and keep the server receipt timestamp on retries", async () => {
  const record = await device(); const issued = await pair(record); const data = report();
  const first = await send(data, issued.deviceToken); assert.equal(first.status, 200); assert.equal(first.headers.get("cache-control"), "no-store"); assert.equal(first.headers.get("set-cookie"), null);
  const receipt = await first.json(); assert.equal(receipt.reportId, data.reportId);
  const repeated = await send(data, issued.deviceToken); assert.deepEqual(await repeated.json(), receipt);
  assert.equal(await prisma.deviceStorageReport.count({ where: { deviceId: record.id } }), 1);
  const read = await get(record.id); const body = await read.json();
  assert.equal(body.device.storage.totalBytes, 768 * 1024 ** 3); assert.equal(body.device.storage.freeBytes, 228 * 1024 ** 3); assert.equal(body.device.storage.usedBytes, 540 * 1024 ** 3);
  assert.equal(body.device.storage.volumes[0].usedBytes, 384 * 1024 ** 3); assert.equal(body.device.storage.receivedAt, receipt.receivedAt);
  assert.equal((await get(record.id, otherToken)).status, 404);
  const text = JSON.stringify(body); for (const secret of [issued.deviceToken, "credentialId", "tokenHash", "ownerId", "reportId"]) assert.ok(!text.includes(secret));
  assert.equal((await send({ ...data, volumes: [{ id: "C:\\", totalBytes: 100, freeBytes: 0 }] }, issued.deviceToken)).status, 409);
});
test("late reports and concurrent writers cannot overwrite newer collected data", async () => {
  const record = await device(); const issued = await pair(record); const now = Date.now();
  const old = report(new Date(now - 2000)); const newer = report(new Date(now - 1000));
  const responses = await Promise.all([send(newer, issued.deviceToken), send(old, issued.deviceToken)]);
  assert.ok(responses.every((response) => [200, 409].includes(response.status)));
  assert.equal((await prisma.deviceStorageReport.findUnique({ where: { deviceId: record.id } })).reportId, newer.reportId);
  assert.equal((await send(old, issued.deviceToken)).status, 409);
});
test("replacement and revocation hide earlier reports, reject old senders and removal cascades snapshots", async () => {
  const record = await device(); const first = await pair(record); await send(report(), first.deviceToken);
  const replacement = await pair(record);
  assert.equal((await (await get(record.id)).json()).device.storage, null);
  assert.equal((await send(report(), first.deviceToken)).status, 401);
  assert.equal((await send(report(), replacement.deviceToken)).status, 200);
  await disconnectDevice(owner.id, record.id, {});
  assert.equal((await (await get(record.id)).json()).device.storage, null);
  assert.equal((await send(report(), replacement.deviceToken)).status, 401);
  await prisma.device.delete({ where: { id: record.id } });
  assert.equal(await prisma.deviceStorageReport.count({ where: { deviceId: record.id } }), 0);
});
test("the native app can revoke its own credential without affecting another device", async () => {
  const one = await device(); const two = await device(); const first = await pair(one); const second = await pair(two);
  const response = await fetch(`${base}/api/v1/companion/disconnect`, { method: "POST", headers: { Authorization: `Device ${first.deviceToken}`, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 204); assert.equal((await send(report(), first.deviceToken)).status, 401);
  assert.equal((await send(report(), second.deviceToken)).status, 200);
});

test("paired apps automatically sync only their own brand, model and OS; revoked apps cannot change details", async () => {
  const record = await device(); const otherDevice = await device(); const issued = await pair(record);
  const sync = (body, credential = issued.deviceToken) => fetch(`${base}/api/v1/companion/device-details`, { method: "POST", headers: { Authorization: `Device ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await sync({ brand: " Acer ", model: " Swift Go ", os: " Windows 11 Home " })).status, 200);
  const saved = (await (await get(record.id)).json()).device;
  assert.equal(saved.brand, "Acer"); assert.equal(saved.model, "Swift Go"); assert.equal(saved.os, "Windows 11 Home"); assert.equal(saved.name, record.name);
  assert.equal((await (await get(otherDevice.id)).json()).device.brand, null);
  assert.equal((await sync({ os: "Windows 11 Pro" })).status, 200);
  assert.equal((await (await get(record.id)).json()).device.model, "Swift Go");
  for (const input of [{ brand: "x".repeat(81) }, { model: " " }, { os: "bad\0value" }, {}, { name: "PRIVATE_NAME" }, { brand: "Acer", deviceId: otherDevice.id }]) {
    const rejected = await sync(input); assert.equal(rejected.status, 400); assert.ok(!(await rejected.text()).includes("PRIVATE_NAME"));
  }
  assert.equal((await sync({ brand: "Spoofed" }, token)).status, 401);
  await disconnectDevice(owner.id, record.id, {});
  assert.equal((await sync({ brand: "Revoked" })).status, 401);
  assert.equal((await prisma.device.findUnique({ where: { id: record.id } })).brand, "Acer");
});
test("Windows companion pairs, saves a real DPAPI credential, reads capacity and stops after website revocation", { skip: process.platform !== "win32", timeout: 60000 }, async () => {
  const record = await device(); const start = await startDevicePairing(owner.id, record.id, {});
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-File", fileURLToPath(new URL("../../../companion/windows/tests/Test-LivePairing.ps1", import.meta.url))], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const exit = once(child, "exit");
  // Capture only a fixed harness error; never log child configuration or credentials.
  let failed = false; child.stderr.on("data", () => { failed = true; });
  child.stdin.write(JSON.stringify({ origin: base, code: start.code }) + "\n");
  let complete = false;
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const event = JSON.parse(line);
      if (event.stage === "claimed") {
        const pairing = await prisma.devicePairingSession.findUnique({ where: { id: start.pairing.id } });
        assert.equal(event.comparisonCode, pairing.comparisonCode);
        await decideDevicePairing(owner.id, record.id, pairing.id, "approve", { claimId: pairing.claimId });
      } else if (event.stage === "profile-synced") {
        const saved = (await (await get(record.id)).json()).device;
        assert.ok(saved.brand || saved.model || saved.os); assert.equal(saved.name, record.name);
      } else if (event.stage === "reported") {
        const snapshot = await prisma.deviceStorageReport.findUnique({ where: { deviceId: record.id } });
        assert.equal(snapshot.reportId, event.reportId); assert.ok(snapshot.volumes.length > 0);
        assert.ok((await (await get(record.id)).json()).device.storage.totalBytes > 0);
      } else if (event.stage === "folder-scanned") {
        const saved = await prisma.deviceFolderScan.findUnique({ where: { deviceId: record.id } });
        assert.equal(saved.report.fileCount, 1); assert.equal(saved.report.totalBytes, 12); assert.equal(saved.report.largestFiles[0].relativePath, "sample.txt");
        await disconnectDevice(owner.id, record.id, {}); child.stdin.write("revoked\n");
      } else if (event.stage === "complete") complete = true;
    }
    const [code] = await exit; assert.equal(code, 0, "Native harness exited unsuccessfully"); assert.equal(failed, false); assert.equal(complete, true);
  } finally { child.stdin.end(); if (child.exitCode === null) child.kill(); }
});
test("report rate limits are separate from companion identity reads", async () => {
  let response; for (let index = 0; index < 61; index++) response = await send({});
  assert.equal(response.status, 429); assert.equal((await fetch(`${base}/health`)).status, 200);
});
