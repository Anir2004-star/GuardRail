import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { before, after, test } from "node:test";
const database = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test"); assert.match(database ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL).pathname, `/${database}`); assert.notEqual(database, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
const { app } = await import("../../dist/app.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerVerifiedUser } = await import("../helpers/verified-user.mjs");
const { createAccessToken } = await import("../../dist/auth/access-tokens.js");
const { registerDevice } = await import("../../dist/services/device.service.js");
const { startDevicePairing, claimDevicePairing, decideDevicePairing, exchangeDevicePairing, disconnectDevice } = await import("../../dist/services/device-pairing.service.js");
const { pairingHash } = await import("../../dist/auth/device-pairing.js");
const { acceptFolderScan } = await import("../../dist/services/folder-scan.service.js");
let owner, token, otherToken, server, base;
before(async () => {
  const account = () => registerVerifiedUser({ firstName: "Scan", lastName: "Owner", email: `scan-${randomUUID()}@example.invalid`, password: "Scan test!12345" });
  owner = await account(); const other = await account(); token = (await createAccessToken(owner.id)).accessToken; otherToken = (await createAccessToken(other.id)).accessToken;
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await disconnectDatabase(); });
const input = (time = Date.now()) => ({ scanId: randomUUID(), folderName: "Scan sample", startedAt: new Date(time - 1000).toISOString(), finishedAt: new Date(time).toISOString(), fileCount: 1, totalBytes: 100, skippedCount: 1, limitReached: false, types: [{ type: ".txt", count: 1, bytes: 100 }], largestFiles: [{ relativePath: "nested/example.txt", type: ".txt", bytes: 100, modifiedAt: new Date(time).toISOString() }] });
async function fixture() {
  const device = await registerDevice(owner.id, { requestId: randomUUID(), name: "Scanning laptop", type: "Laptop" });
  const start = await startDevicePairing(owner.id, device.id, {}); const claim = await claimDevicePairing({ code: start.code, appName: "Scan app", platform: "Windows" });
  const row = await prisma.devicePairingSession.findUnique({ where: { id: claim.pairingId } });
  await decideDevicePairing(owner.id, device.id, row.id, "approve", { claimId: row.claimId });
  const credential = await exchangeDevicePairing(pairingHash("claim", claim.claimToken), {});
  return { device, credential, hash: pairingHash("device", credential.deviceToken) };
}
const read = (id, bearer = token) => fetch(`${base}/api/v1/devices/${id}/folder-scan`, { headers: { Authorization: `Bearer ${bearer}` } });
const send = (report, credential) => fetch(`${base}/api/v1/companion/folder-scans`, { method: "POST", headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Device ${credential}` } : {}) }, body: JSON.stringify(report) });
test("authenticated companion uploads are owner-only, bounded and retry-safe", async () => {
  const { device, credential, hash } = await fixture();
  assert.equal((await send(input())).status, 401); assert.equal((await send(input(), token)).status, 401);
  assert.deepEqual(await (await read(device.id)).json(), { scan: null });
  const report = input(); const response = await send(report, credential.deviceToken); assert.equal(response.status, 200); const receipt = await response.json();
  assert.deepEqual(await acceptFolderScan(hash, report), { scanId: receipt.scanId, receivedAt: new Date(receipt.receivedAt) });
  const result = await read(device.id); assert.equal(result.headers.get("cache-control"), "no-store"); const body = await result.json();
  assert.equal(body.scan.largestFiles[0].relativePath, "nested/example.txt"); assert.equal(body.scan.totalBytes, 100);
  assert.equal((await read(device.id, otherToken)).status, 404);
  for (const privateField of ["credentialId", "tokenHash", "userId", credential.deviceToken]) assert.ok(!JSON.stringify(body).includes(privateField));
  await assert.rejects(() => acceptFolderScan(hash, { ...report, folderName: "Changed" }), (error) => error.status === 409);
  await assert.rejects(() => acceptFolderScan(hash, input(Date.now() - 2000)), (error) => error.code === "STALE_SCAN");
});
test("revocation and replacement hide prior file metadata; device deletion removes snapshots", async () => {
  const { device, hash, credential } = await fixture(); await acceptFolderScan(hash, input());
  await disconnectDevice(owner.id, device.id, {});
  assert.deepEqual(await (await read(device.id)).json(), { scan: null });
  assert.equal((await send(input(), credential.deviceToken)).status, 401);
  await prisma.device.delete({ where: { id: device.id } });
  assert.equal(await prisma.deviceFolderScan.count({ where: { deviceId: device.id } }), 0);
});
test("invalid input and excess requests leave other device APIs available", async () => {
  const { credential } = await fixture();
  const response = await send({ ...input(), largestFiles: [{ ...input().largestFiles[0], relativePath: "../PRIVATE_PATH" }] }, credential.deviceToken);
  assert.equal(response.status, 400); assert.ok(!(await response.text()).includes("PRIVATE_PATH"));
  let last; for (let index = 0; index < 11; index++) last = await send({});
  assert.equal(last.status, 429); assert.equal((await fetch(`${base}/health`)).status, 200);
});
