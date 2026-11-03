import assert from "node:assert/strict";
import console from "node:console";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { URL } from "node:url";
import { after, before, test } from "node:test";

const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);

const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerUser, createLoginSession } = await import("../../dist/services/auth.service.js");
const { rotateRefreshSession } = await import("../../dist/services/refresh-session.service.js");
const { generateRefreshToken } = await import("../../dist/auth/refresh-tokens.js");
const { REFRESH_COOKIE_NAME } = await import("../../dist/auth/refresh-cookie.js");
const password = "Logout route Passphrase!42";
let user;
let server;
let base;

before(async () => {
  user = await registerUser({ firstName: "Logout", lastName: "Tester", email: `logout-${randomUUID()}@example.invalid`, password });
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

function request(route, token, extra = {}) {
  const headers = { Origin: env.FRONTEND_ORIGIN, ...extra };
  if (token !== undefined) headers.Cookie = `${REFRESH_COOKIE_NAME}=${token}`;
  return globalThis.fetch(`${base}/api/v1/auth/${route}`, { method: "POST", headers });
}
function start() { return createLoginSession({ email: user.email, password }); }
async function loggedOut(response) {
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const cookie = response.headers.get("set-cookie");
  for (const flag of [`${REFRESH_COOKIE_NAME}=;`, "Expires=Thu, 01 Jan 1970 00:00:00 GMT", "HttpOnly", "Path=/api/v1/auth", "SameSite=Lax"]) assert.ok(cookie.includes(flag));
}

test("logout revokes the current family, clears its cookie and prevents refresh", async () => {
  const session = await start();
  const response = await request("logout", session.refresh.token.value);
  await loggedOut(response);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.equal(response.headers.get("access-control-allow-origin"), env.FRONTEND_ORIGIN);
  assert.ok((await prisma.refreshSession.findUniqueOrThrow({ where: { id: session.refresh.sessionId } })).revokedAt);
  assert.equal((await request("refresh", session.refresh.token.value)).status, 401);
});

test("logout using an old rotated cookie revokes descendants while independent logins remain usable", async () => {
  const original = await start();
  const independent = await start();
  const child = await rotateRefreshSession(original.refresh.token.value);
  await loggedOut(await request("logout", original.refresh.token.value));
  const family = await prisma.refreshSession.findMany({ where: { familyId: original.refresh.familyId } });
  assert.equal(family.length, 2);
  assert.ok(family.every((row) => row.revokedAt));
  assert.equal((await request("refresh", child.refresh.token.value)).status, 401);
  assert.equal((await request("refresh", independent.refresh.token.value)).status, 200);
});

test("missing, unknown, malformed, duplicate and already revoked cookies are safely idempotent", async () => {
  const session = await start();
  await loggedOut(await request("logout", session.refresh.token.value));
  const count = await prisma.refreshSession.count();
  for (const value of [undefined, "PRIVATE_INVALID_TOKEN", generateRefreshToken().value, session.refresh.token.value]) {
    await loggedOut(await request("logout", value));
  }
  await loggedOut(await request("logout", undefined, { Cookie: `${REFRESH_COOKIE_NAME}=; ${REFRESH_COOKIE_NAME}=invalid` }));
  assert.equal(await prisma.refreshSession.count(), count);
});

test("an expired session can still be explicitly revoked", async () => {
  const session = await start();
  await prisma.refreshSession.update({ where: { id: session.refresh.sessionId }, data: { expiresAt: new Date(0) } });
  await loggedOut(await request("logout", session.refresh.token.value));
  assert.ok((await prisma.refreshSession.findUniqueOrThrow({ where: { id: session.refresh.sessionId } })).revokedAt);
});

test("logout racing refresh leaves no active member of the family", async () => {
  const session = await start();
  const [refresh, logout] = await Promise.all([request("refresh", session.refresh.token.value), request("logout", session.refresh.token.value)]);
  await loggedOut(logout);
  assert.ok([200, 401].includes(refresh.status));
  const family = await prisma.refreshSession.findMany({ where: { familyId: session.refresh.familyId } });
  assert.ok(family.every((row) => row.revokedAt));
  if (refresh.status === 200) {
    const cookie = refresh.headers.get("set-cookie").split(";")[0].slice(REFRESH_COOKIE_NAME.length + 1);
    assert.equal((await request("refresh", cookie)).status, 401);
  }
});

test("database failure is generic, preserves the cookie and supports explicit retry", async (t) => {
  const session = await start();
  const logger = t.mock.method(console, "error", () => {});
  let release;
  let locked;
  const gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { locked = resolve; });
  // Hold only this test user's row long enough to exercise the configured
  // PostgreSQL statement timeout in the real logout transaction.
  const blocker = prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
    locked();
    await gate;
  }, { timeout: 10000 });
  await entered;
  let response;
  try { response = await request("logout", session.refresh.token.value); }
  finally { release(); await blocker; }
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } });
  assert.deepEqual(logger.mock.calls.map((call) => call.arguments), [["Unexpected request error"]]);
  assert.equal((await prisma.refreshSession.findUniqueOrThrow({ where: { id: session.refresh.sessionId } })).revokedAt, null);
  await loggedOut(await request("logout", session.refresh.token.value));
});

test("origin rejection and preflight cannot log the user out", async () => {
  const session = await start();
  for (const origin of [undefined, "null", "https://unexpected.example", `${env.FRONTEND_ORIGIN}/`]) {
    const headers = { Cookie: `${REFRESH_COOKIE_NAME}=${session.refresh.token.value}` };
    if (origin !== undefined) headers.Origin = origin;
    const response = await globalThis.fetch(`${base}/api/v1/auth/logout`, { method: "POST", headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("ratelimit"), null);
  }
  const response = await globalThis.fetch(`${base}/api/v1/auth/logout`, {
    method: "OPTIONS", headers: { Origin: env.FRONTEND_ORIGIN, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await prisma.refreshSession.findUniqueOrThrow({ where: { id: session.refresh.sessionId } })).revokedAt, null);
});

test("logout throttling does not consume login, signup or refresh quota", async () => {
  const session = await start();
  let limited;
  for (let index = 0; index <= 30; index++) {
    const response = await request("logout", undefined);
    if (response.status === 429) { limited = response; break; }
    await loggedOut(response);
  }
  assert.ok(limited);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.equal(limited.headers.get("set-cookie"), null);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await request("logout", session.refresh.token.value)).status, 429);
  assert.equal((await prisma.refreshSession.findUniqueOrThrow({ where: { id: session.refresh.sessionId } })).revokedAt, null);
  assert.equal((await request("refresh", session.refresh.token.value)).status, 200);
  for (const route of ["login", "register"]) {
    const response = await globalThis.fetch(`${base}/api/v1/auth/${route}`, {
      method: "POST", headers: { Origin: env.FRONTEND_ORIGIN, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 400);
  }
  assert.equal((await globalThis.fetch(`${base}/health`)).status, 200);
  assert.equal((await globalThis.fetch(`${base}/ready`)).status, 200);
});
