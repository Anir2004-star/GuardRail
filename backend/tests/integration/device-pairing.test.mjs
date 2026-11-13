import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { before, after, test } from "node:test";

const database = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(database ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL).pathname, `/${database}`);
assert.notEqual(database, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerVerifiedUser } = await import("../helpers/verified-user.mjs");
const { createAccessToken } = await import("../../dist/auth/access-tokens.js");
const { registerDevice, removeDevice } = await import("../../dist/services/device.service.js");
const { startDevicePairing, claimDevicePairing, decideDevicePairing, exchangeDevicePairing, disconnectDevice } = await import("../../dist/services/device-pairing.service.js");
const { pairingHash, createPairingCode, createPairingToken, readPairingCredential } = await import("../../dist/auth/device-pairing.js");
let server, base, owner, other, token, otherToken;
const register = () => registerDevice(owner.id, { requestId: randomUUID(), name: "Pairing laptop", type: "Laptop" });
before(async () => {
  const account = () => registerVerifiedUser({ firstName: "Pairing", lastName: "Owner", email: `pairing-${randomUUID()}@example.invalid`, password: "Pairing test!12345" });
  owner = await account(); other = await account(); token = (await createAccessToken(owner.id)).accessToken; otherToken = (await createAccessToken(other.id)).accessToken;
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await disconnectDatabase(); });
function call(method, path, body, authorization, origin) {
  return fetch(`${base}/api/v1/${path}`, { method, headers: { ...(authorization ? { Authorization: authorization } : {}), ...(origin ? { Origin: origin } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const own = (method, path, body = {}, bearer = token, origin = env.FRONTEND_ORIGIN) => call(method, `devices/${path}`, method === "GET" ? undefined : body, `Bearer ${bearer}`, origin);
async function claimed(device) {
  const start = await startDevicePairing(owner.id, device.id, {});
  const claim = await claimDevicePairing({ code: start.code, appName: "Guardrail companion", platform: "Windows", appVersion: "0.1" });
  const row = await prisma.devicePairingSession.findUnique({ where: { id: claim.pairingId } });
  return { start, claim, row, hash: pairingHash("claim", claim.claimToken) };
}
async function paired(device) {
  const data = await claimed(device);
  await decideDevicePairing(owner.id, device.id, data.row.id, "approve", { claimId: data.row.claimId });
  return { ...data, credential: await exchangeDevicePairing(data.hash, {}) };
}

test("random credentials are canonical, purpose-separated and header schemes reject duplicates", () => {
  const codes = new Set(Array.from({ length: 200 }, createPairingCode)); assert.equal(codes.size, 200);
  for (const code of codes) assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  const secret = createPairingToken("device"); assert.match(secret, /^gr_device_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(pairingHash("claim", secret), pairingHash("device", secret));
  const request = { rawHeaders: ["Authorization", `Device ${secret}`], headers: { authorization: `Device ${secret}` } };
  assert.equal(readPairingCredential(request, "device"), pairingHash("device", secret));
  assert.throws(() => readPairingCredential(request, "claim"));
  assert.throws(() => readPairingCredential({ ...request, rawHeaders: [...request.rawHeaders, ...request.rawHeaders] }, "device"));
});
test("owner routes require JWT, correct Origin, owned device and strict empty bodies", async () => {
  const device = await register();
  assert.equal((await call("POST", `devices/${device.id}/pairing`, {})).status, 403);
  assert.equal((await own("POST", `${device.id}/pairing`, {}, token, "https://wrong.invalid")).status, 403);
  assert.equal((await own("POST", `${device.id}/pairing`, {}, otherToken)).status, 404);
  assert.equal((await own("GET", `${device.id}/pairing`, {}, otherToken)).status, 404);
  const bad = await own("POST", `${device.id}/pairing`, { secret: "PRIVATE_SECRET" }); assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes("PRIVATE_SECRET"));
});
test("codes are stored only as hashes, claimed once; owner GET never exposes either secret", async () => {
  const device = await register(); const response = await own("POST", `${device.id}/pairing`);
  assert.equal(response.status, 201); assert.equal(response.headers.get("cache-control"), "no-store");
  const start = await response.json(); const row = await prisma.devicePairingSession.findUnique({ where: { id: start.pairing.id } });
  const lifetime = row.expiresAt.getTime() - row.createdAt.getTime();
  assert.ok(lifetime >= 899000 && lifetime <= 901000, "Pairing must last fifteen minutes");
  assert.equal(row.codeHash, pairingHash("code", start.code.replaceAll("-", "")));
  const claims = await Promise.all([1, 2].map(() => call("POST", "pairing/claim", { code: start.code, appName: "App", platform: "Windows" })));
  assert.deepEqual(claims.map((res) => res.status).sort(), [201, 409]);
  const claim = await claims.find((res) => res.status === 201).json();
  const get = await own("GET", `${device.id}/pairing`); const body = await get.text();
  assert.ok(!body.includes(start.code)); assert.ok(!body.includes(claim.claimToken)); assert.ok(!body.includes("Hash"));
  const status = await call("GET", "pairing/status", undefined, `Pairing ${claim.claimToken}`); assert.equal(status.status, 200);
  assert.deepEqual(Object.keys(await status.json()).sort(), ["state", "comparisonCode", "expiresAt", "pollIntervalSeconds"].sort());
});
test("explicit matching claim approval is required; exchanges are one-time under concurrency", async () => {
  const device = await register(); const data = await claimed(device);
  assert.equal((await call("POST", "pairing/exchange", {}, `Pairing ${data.claim.claimToken}`)).status, 409);
  assert.equal((await own("POST", `${device.id}/pairing/${data.row.id}/approve`, { claimId: randomUUID() })).status, 409);
  assert.equal((await own("POST", `${device.id}/pairing/${data.row.id}/approve`, { claimId: data.row.claimId }, otherToken)).status, 404);
  const approve = await own("POST", `${device.id}/pairing/${data.row.id}/approve`, { claimId: data.row.claimId }); assert.equal(approve.status, 200);
  assert.equal((await (await own("GET", device.id)).json()).device.paired, false);
  const exchanges = await Promise.all([1, 2].map(() => call("POST", "pairing/exchange", {}, `Pairing ${data.claim.claimToken}`)));
  assert.deepEqual(exchanges.map((res) => res.status).sort(), [201, 409]);
  const issued = await exchanges.find((res) => res.status === 201).json();
  assert.match(issued.deviceToken, /^gr_device_/); assert.equal(await prisma.deviceCredential.count({ where: { deviceId: device.id, revokedAt: null } }), 1);
  const saved = await prisma.deviceCredential.findUnique({ where: { pairingId: data.row.id } }); assert.equal(saved.tokenHash, pairingHash("device", issued.deviceToken));
  const record = (await (await own("GET", device.id)).json()).device; assert.equal(record.paired, true); assert.equal(record.status, "paired"); assert.equal(record.storage, null); assert.ok(record.pairedAt);
  const me = await call("GET", "companion/me", undefined, `Device ${issued.deviceToken}`); assert.equal(me.status, 200); assert.ok(!(await me.text()).includes(owner.email));
  assert.equal((await call("GET", "auth/me", undefined, `Bearer ${issued.deviceToken}`)).status, 401);
  assert.equal((await call("GET", "companion/me", undefined, `Bearer ${token}`)).status, 401);
  assert.equal((await call("GET", "pairing/status", undefined, `Device ${issued.deviceToken}`)).status, 401);
});
test("expired, cancelled and rejected sessions cannot produce device credentials", async () => {
  for (const decision of ["expire", "cancel", "reject"]) {
    const device = await register(); const data = await claimed(device);
    if (decision === "expire") await prisma.devicePairingSession.update({ where: { id: data.row.id }, data: { expiresAt: new Date(0) } });
    else await decideDevicePairing(owner.id, device.id, data.row.id, decision, {});
    assert.equal((await call("POST", "pairing/exchange", {}, `Pairing ${data.claim.claimToken}`)).status, 409);
    const state = (await (await own("GET", `${device.id}/pairing`)).json()).pairing.state;
    assert.equal(state, decision === "expire" ? "Expired" : decision === "cancel" ? "Cancelled" : "Rejected");
    assert.equal(await prisma.deviceCredential.count({ where: { deviceId: device.id } }), 0);
  }
});
test("replacing pending pairing cancels the old claim; existing app stays authorized until new exchange", async () => {
  const device = await register(); const old = await paired(device); const abandoned = await claimed(device); const next = await claimed(device);
  assert.equal((await prisma.devicePairingSession.findUnique({ where: { id: abandoned.row.id } })).state, "Cancelled");
  assert.equal((await call("GET", "companion/me", undefined, `Device ${old.credential.deviceToken}`)).status, 200);
  await decideDevicePairing(owner.id, device.id, next.row.id, "approve", { claimId: next.row.claimId });
  const replacement = await exchangeDevicePairing(next.hash, {});
  assert.equal((await call("GET", "companion/me", undefined, `Device ${old.credential.deviceToken}`)).status, 401);
  assert.equal((await call("GET", "companion/me", undefined, `Device ${replacement.deviceToken}`)).status, 200);
});
test("disconnect, expiry and removal immediately invalidate credentials and pending sessions", async () => {
  const device = await register(); const data = await paired(device); const pending = await claimed(device);
  assert.equal((await own("POST", `${device.id}/disconnect`, {}, otherToken)).status, 404);
  assert.equal((await own("POST", `${device.id}/disconnect`)).status, 204);
  assert.equal((await call("GET", "companion/me", undefined, `Device ${data.credential.deviceToken}`)).status, 401);
  assert.equal((await prisma.devicePairingSession.findUnique({ where: { id: pending.row.id } })).state, "Cancelled");
  assert.equal((await (await own("GET", device.id)).json()).device.paired, false);
  const second = await paired(device);
  await prisma.deviceCredential.updateMany({ where: { deviceId: device.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await call("GET", "companion/me", undefined, `Device ${second.credential.deviceToken}`)).status, 401);
  assert.equal((await (await own("GET", device.id)).json()).device.paired, false);
  const third = await paired(device); await removeDevice(owner.id, device.id);
  assert.equal((await call("GET", "companion/me", undefined, `Device ${third.credential.deviceToken}`)).status, 401);
  assert.equal(await prisma.devicePairingSession.count({ where: { deviceId: device.id } }), 0);
  assert.equal(await prisma.deviceCredential.count({ where: { deviceId: device.id } }), 0);
});
test("claim endpoint rejects unexpected origins and query parameters and rate limits guesses", async () => {
  assert.equal((await call("POST", "pairing/claim", { code: "ABCDEFGHJKLM", appName: "App", platform: "Windows" }, undefined, "https://wrong.invalid")).status, 403);
  assert.equal((await call("GET", "pairing/status?token=not-accepted", undefined)).status, 400);
  let last; for (let attempt = 0; attempt < 21; attempt++) last = await call("POST", "pairing/claim", { code: "ABCDEFGHJKLM", appName: "App", platform: "Windows" });
  assert.equal(last.status, 429); assert.equal(last.headers.get("set-cookie"), null);
});
