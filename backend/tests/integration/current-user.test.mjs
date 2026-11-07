import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import process from "node:process";
import { URL } from "node:url";
import { after, before, test } from "node:test";
import { SignJWT } from "jose";

const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerVerifiedUser: registerUser } = await import("../helpers/verified-user.mjs");
const { createAccessToken } = await import("../../dist/auth/access-tokens.js");
let user;
let token;
let server;
let base;
before(async () => {
  user = await registerUser({ firstName: "Current", middleName: "Safe", lastName: "User", email: `current-${randomUUID()}@example.invalid`, password: "Current user Passphrase!42" });
  token = (await createAccessToken(user.id)).accessToken;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
});
function me(authorization, path = "/api/v1/auth/me", extra = {}) {
  const headers = { Origin: env.FRONTEND_ORIGIN, ...extra };
  if (authorization !== undefined) headers.Authorization = authorization;
  return globalThis.fetch(`${base}${path}`, { headers });
}
async function unauthorized(response) {
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="guardrail"');
  assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED", message: "A valid access token is required" } });
}

test("verified bearer credentials return only the current safe database profile", async () => {
  const response = await me(`Bearer ${token}`, `/api/v1/auth/me?userId=${randomUUID()}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), env.FRONTEND_ORIGIN);
  const body = await response.json();
  assert.deepEqual(body, { user: { ...user, createdAt: user.createdAt.toISOString() } });
  assert.equal("passwordHash" in body.user, false);
  assert.equal("refreshSessions" in body.user, false);
  assert.ok(!JSON.stringify(body).includes(token));
});

test("missing, malformed, wrong-signature and expired access tokens are rejected without cookie authentication", async () => {
  for (const authorization of [undefined, "Basic PRIVATE_PASSWORD", "Bearer a.b.c", `Bearer ${token.slice(0, token.lastIndexOf(".") + 1)}${"A".repeat(43)}`]) await unauthorized(await me(authorization));
  await unauthorized(await me(undefined, "/api/v1/auth/me", { Cookie: "guardrail_refresh=PRIVATE_COOKIE" }));
  const now = Math.floor(Date.now() / 1000);
  const key = Buffer.from(env.JWT_ACCESS_SECRET, "hex");
  const expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256", typ: "at+jwt" }).setSubject(user.id)
    .setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setIssuedAt(now - 901).setExpirationTime(now - 1).setJti(randomUUID()).sign(key);
  await unauthorized(await me(`Bearer ${expired}`));
  const wrongKey = await new SignJWT({}).setProtectedHeader({ alg: "HS256", typ: "at+jwt" }).setSubject(user.id)
    .setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setIssuedAt(now).setExpirationTime(now + 900).setJti(randomUUID()).sign(randomBytes(32));
  await unauthorized(await me(`Bearer ${wrongKey}`));
});

test("duplicate raw Authorization headers are rejected rather than choosing an identity", async () => {
  const result = await new Promise((resolve, reject) => {
    const request = http.get(`${base}/api/v1/auth/me`, { headers: { Authorization: [`Bearer ${token}`, `Bearer ${token}`] } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
  });
  assert.equal(result.status, 401);
  assert.equal(JSON.parse(result.body).error.code, "UNAUTHORIZED");
});

test("validly signed tokens for missing or deleted accounts are rejected", async () => {
  await unauthorized(await me(`Bearer ${(await createAccessToken(randomUUID())).accessToken}`));
  const removed = await prisma.user.create({ data: { email: `deleted-current-${randomUUID()}@example.invalid` } });
  const removedToken = (await createAccessToken(removed.id)).accessToken;
  await prisma.user.delete({ where: { id: removed.id } });
  await unauthorized(await me(`Bearer ${removedToken}`));
});

test("current profile is read again for each authorized request", async () => {
  await prisma.user.update({ where: { id: user.id }, data: { name: "Updated Current User" } });
  const response = await me(`Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.name, "Updated Current User");
});

test("credentialed CORS preflight permits the Authorization header without authenticating a cookie", async () => {
  const response = await globalThis.fetch(`${base}/api/v1/auth/me`, {
    method: "OPTIONS", headers: { Origin: env.FRONTEND_ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization" },
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-headers"), /authorization/i);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("database availability errors remain generic 500 failures rather than invalidating credentials", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  let release;
  let locked;
  const entered = new Promise((resolve) => { locked = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const blocker = prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`LOCK TABLE "users" IN ACCESS EXCLUSIVE MODE`;
    locked();
    await gate;
  }, { timeout: 10000 });
  await entered;
  let response;
  try { response = await me(`Bearer ${token}`); } finally { release(); await blocker; }
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } });
  assert.deepEqual(logger.mock.calls.map((call) => call.arguments), [["Unexpected request error"]]);
  assert.equal((await me(`Bearer ${token}`)).status, 200);
});
