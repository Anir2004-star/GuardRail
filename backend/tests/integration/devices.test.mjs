import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { after, before, test } from "node:test";
import pg from "pg";

const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerVerifiedUser } = await import("../helpers/verified-user.mjs");
const { createAccessToken } = await import("../../dist/auth/access-tokens.js");
const { registerUser, createLoginSession } = await import("../../dist/services/auth.service.js");
const { registerDevice } = await import("../../dist/services/device.service.js");
const password = "Device account!42";
const account = () => registerVerifiedUser({ firstName: "Device", lastName: "Owner", email: `device-${randomUUID()}@example.invalid`, password });
const details = (overrides = {}) => ({ requestId: randomUUID(), name: " My laptop ", type: "Laptop", brand: " ACER ", model: " Swift ", os: " Windows ", ...overrides });
let server, base, ownerA, ownerB, tokenA, tokenB, device;
before(async () => {
  ownerA = await account(); ownerB = await account();
  tokenA = (await createAccessToken(ownerA.id)).accessToken; tokenB = (await createAccessToken(ownerB.id)).accessToken;
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await disconnectDatabase(); });
function call(method, path = "", body, bearer = tokenA, origin = env.FRONTEND_ORIGIN, extra = {}) {
  return globalThis.fetch(`${base}/api/v1/devices${path}`, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(origin ? { Origin: origin } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const publicFields = ["id", "name", "type", "brand", "model", "os", "createdAt", "updatedAt", "status", "paired", "storage"].sort();
test("device endpoints require real bearer authentication and verified account access", async () => {
  assert.equal((await call("GET", "", undefined, null)).status, 401);
  assert.equal((await call("GET", "", undefined, "invalid.jwt.token")).status, 401);
  assert.equal((await call("GET", "", undefined, null, env.FRONTEND_ORIGIN, { Cookie: "guardrail_refresh=ignored" })).status, 401);
  const pending = await registerUser({ firstName: "Pending", lastName: "Owner", email: `pending-device-${randomUUID()}@example.invalid`, password });
  const token = (await createAccessToken(pending.id)).accessToken;
  assert.equal((await call("POST", "", details(), token)).status, 403);
  assert.equal(await prisma.device.count({ where: { userId: pending.id } }), 0);
});
test("registration saves normalized metadata with server-assigned ownership, safe fields and no invented storage", async () => {
  const response = await call("POST", "", details()); assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("set-cookie"), null);
  device = (await response.json()).device;
  assert.deepEqual(Object.keys(device).sort(), publicFields);
  assert.equal(device.name, "My laptop"); assert.equal(device.brand, "ACER"); assert.equal(device.type, "Laptop");
  assert.equal(device.status, "registered"); assert.equal(device.paired, false); assert.equal(device.storage, null);
  assert.ok(Number.isFinite(Date.parse(device.createdAt)));
  assert.equal((await prisma.device.findUnique({ where: { id: device.id } })).userId, ownerA.id);
  const before = await prisma.device.count();
  const spoofed = await call("POST", "", { ...details(), userId: ownerB.id });
  assert.equal(spoofed.status, 400); assert.equal(await prisma.device.count(), before);
});
test("lists and details are owner-scoped; foreign and unknown identifiers return identical 404 responses", async () => {
  const other = await registerDevice(ownerB.id, details({ name: "Other account tablet", type: "Tablet" }));
  const own = await call("GET"); assert.deepEqual((await own.json()).devices.map((entry) => entry.id), [device.id]);
  const theirs = await call("GET", "", undefined, tokenB); assert.deepEqual((await theirs.json()).devices.map((entry) => entry.id), [other.id]);
  assert.equal((await call("GET", `/${device.id}`)).status, 200);
  const foreign = await call("GET", `/${device.id}`, undefined, tokenB);
  const unknown = await call("GET", `/${randomUUID()}`, undefined, tokenB);
  assert.equal(foreign.status, 404); assert.equal(unknown.status, 404); assert.deepEqual(await foreign.json(), await unknown.json());
  assert.equal((await call("GET", `?userId=${ownerB.id}`)).status, 400);
  assert.equal((await call("GET", "/invalid-id")).status, 400);
});
test("rename changes only an owned device name; extra fields and cross-account writes cannot change records", async () => {
  const renamed = await call("PATCH", `/${device.id}`, { name: " Travel laptop " }); assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).device.name, "Travel laptop");
  assert.equal((await call("PATCH", `/${device.id}`, { name: "Stolen" }, tokenB)).status, 404);
  assert.equal((await call("PATCH", `/${device.id}`, { name: "Changed", type: "Tablet" })).status, 400);
  assert.equal((await prisma.device.findUnique({ where: { id: device.id } })).name, "Travel laptop");
});
test("device records survive fresh sign-in and duplicate names remain separate registrations", async () => {
  const login = await createLoginSession({ email: ownerA.email, password });
  const list = await call("GET", "", undefined, login.body.accessToken);
  assert.ok((await list.json()).devices.some((entry) => entry.id === device.id));
  const other = await registerDevice(ownerA.id, details({ name: "Travel laptop" }));
  assert.notEqual(other.id, device.id);
});
test("concurrent retries of one registration create one record; conflicting payloads return 409", async () => {
  const input = details({ name: "Retry-safe phone", type: "Smartphone" });
  const responses = await Promise.all([call("POST", "", input), call("POST", "", input)]);
  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(bodies[0].device.id, bodies[1].device.id);
  assert.equal(await prisma.device.count({ where: { userId: ownerA.id, requestId: input.requestId } }), 1);
  assert.equal((await call("POST", "", { ...input, name: "Different name" })).status, 409);
  // Request IDs are scoped to the owner, not a cross-account identifier.
  assert.notEqual((await registerDevice(ownerB.id, input)).id, bodies[0].device.id);
});
test("the 100-device account cap holds during concurrent registration and account deletion cascades safely", async () => {
  const capped = await account();
  await prisma.device.createMany({ data: Array.from({ length: 99 }, (_, index) => ({ userId: capped.id, requestId: randomUUID(), name: `Fixture ${index}`, type: "Laptop" })) });
  const results = await Promise.allSettled([registerDevice(capped.id, details()), registerDevice(capped.id, details())]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "DEVICE_LIMIT_REACHED");
  assert.equal(await prisma.device.count({ where: { userId: capped.id } }), 100);
  const others = await prisma.device.count({ where: { userId: ownerA.id } });
  await prisma.user.delete({ where: { id: capped.id } });
  assert.equal(await prisma.device.count({ where: { userId: capped.id } }), 0);
  assert.equal(await prisma.device.count({ where: { userId: ownerA.id } }), others);
});
test("remove deletes only the owned registration and returns an empty 204", async () => {
  assert.equal((await call("DELETE", `/${device.id}`, undefined, tokenB)).status, 404);
  assert.ok(await prisma.device.findUnique({ where: { id: device.id } }));
  const response = await call("DELETE", `/${device.id}`); assert.equal(response.status, 204); assert.equal(await response.text(), "");
  assert.equal(await prisma.device.findUnique({ where: { id: device.id } }), null);
  assert.equal((await call("DELETE", `/${device.id}`)).status, 404);
});
test("database lock timeouts return safe 500 responses without storing a partial registration", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  const logger = t.mock.method(console, "error", () => {});
  const input = details({ name: "PRIVATE_DEVICE_NAME" });
  try {
    await client.query("BEGIN"); await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [ownerA.id]);
    const response = await call("POST", "", input); assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes("PRIVATE_DEVICE_NAME"));
    assert.deepEqual(logger.mock.calls.map((entry) => entry.arguments), [["Unexpected request error"]]);
  } finally { await client.query("ROLLBACK"); await client.end(); }
  assert.equal(await prisma.device.count({ where: { userId: ownerA.id, requestId: input.requestId } }), 0);
});
test("mutation origin checks and quotas leave reads and health available", async () => {
  const count = await prisma.device.count();
  assert.equal((await call("POST", "", details(), tokenA, "https://attacker.invalid")).status, 403);
  assert.equal((await call("POST", "", details(), tokenA, "")).status, 403);
  assert.equal(await prisma.device.count(), count);
  const preflight = await globalThis.fetch(`${base}/api/v1/devices`, { method: "OPTIONS", headers: { Origin: env.FRONTEND_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
  assert.equal(preflight.status, 204);
  let response;
  for (let index = 0; index < 62; index++) response = await call("POST", "", {});
  assert.equal(response.status, 429);
  assert.equal((await call("GET")).status, 200);
  assert.equal((await globalThis.fetch(`${base}/health`)).status, 200);
  assert.equal((await globalThis.fetch(`${base}/ready`)).status, 200);
});
