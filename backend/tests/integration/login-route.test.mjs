import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { URL } from "node:url";
import { after, before, test } from "node:test";

// Refuse to write into any database except the runner's newly created test DB.
const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);

const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerVerifiedUser: registerUser } = await import("../helpers/verified-user.mjs");
const { verifyAccessToken } = await import("../../dist/auth/access-tokens.js");
const { hashRefreshToken } = await import("../../dist/auth/refresh-tokens.js");
const { REFRESH_COOKIE_NAME } = await import("../../dist/auth/refresh-cookie.js");
const password = "  Login route Passphrase!42  ";
let user;
let legacy;
let server;
let base;
let endpoint;

before(async () => {
  user = await registerUser({ firstName: "Route", lastName: "Tester", email: `route-${randomUUID()}@example.invalid`, password });
  legacy = await prisma.user.create({ data: { email: `legacy-${randomUUID()}@example.invalid` } });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  endpoint = `${base}/api/v1/auth/login`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
});

function login(body, origin = env.FRONTEND_ORIGIN) {
  const headers = { "Content-Type": "application/json" };
  if (origin !== undefined) headers.Origin = origin;
  return globalThis.fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
}

test("missing and rejected origins get 403 before consuming the login quota", async () => {
  const count = await prisma.refreshSession.count();
  // Exceed the quota numerically to prove origin rejection precedes the limiter.
  for (let index = 0; index < 12; index++) {
    const origin = [null, "null", "https://unexpected.example", `${env.FRONTEND_ORIGIN}/`][index % 4];
    const headers = { "Content-Type": "application/json" };
    if (origin !== null) headers.Origin = origin;
    const response = await globalThis.fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ email: user.email, password }) });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
    assert.equal(response.headers.get("ratelimit"), null);
  }
  assert.equal(await prisma.refreshSession.count(), count);
});

test("credentialed CORS preflight allows only the configured frontend without consuming quota", async () => {
  const count = await prisma.refreshSession.count();
  for (let index = 0; index < 12; index++) {
    const response = await globalThis.fetch(endpoint, {
      method: "OPTIONS", headers: { Origin: env.FRONTEND_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), env.FRONTEND_ORIGIN);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.match(response.headers.get("access-control-allow-methods"), /POST/);
    assert.match(response.headers.get("vary"), /Origin/);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("ratelimit"), null);
  }
  const denied = await globalThis.fetch(endpoint, {
    method: "OPTIONS", headers: { Origin: "https://unexpected.example", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("access-control-allow-credentials"), null);
  assert.equal(await prisma.refreshSession.count(), count);
});

test("public login returns 200, verified access token, safe profile and session cookie", async () => {
  const response = await login({ email: ` ${user.email.toUpperCase()} `, password });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), env.FRONTEND_ORIGIN);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["accessToken", "expiresIn", "tokenType", "user"]);
  assert.equal(body.user.id, user.id);
  assert.equal(body.tokenType, "Bearer");
  assert.equal(body.expiresIn, env.ACCESS_TOKEN_TTL_SECONDS);
  assert.equal((await verifyAccessToken(body.accessToken)).userId, user.id);
  assert.equal("passwordHash" in body.user, false);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  const token = cookie.split(";")[0].slice(REFRESH_COOKIE_NAME.length + 1);
  const session = await prisma.refreshSession.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(token) } });
  assert.equal(session.userId, user.id);
  for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/api/v1/auth", `Expires=${session.expiresAt.toUTCString()}`]) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes("Domain="));
  assert.ok(!cookie.includes("; Secure"));
  assert.ok(!JSON.stringify(body).includes(token));
  assert.ok(!JSON.stringify(body).includes(password));
});

test("wrong, unknown and passwordless accounts receive identical 401 without a cookie or session", async () => {
  const count = await prisma.refreshSession.count();
  for (const input of [
    { email: user.email, password: password.trim() },
    { email: `unknown-${randomUUID()}@example.invalid`, password },
    { email: legacy.email, password },
  ]) {
    const response = await login(input);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  }
  assert.equal(await prisma.refreshSession.count(), count);
});

test("invalid public login input returns safe 400 without creating sessions", async () => {
  const count = await prisma.refreshSession.count();
  for (const input of [{}, { email: "invalid", password: "PRIVATE_PASSWORD" }, { email: user.email, password, extra: "PRIVATE_FIELD" }]) {
    const response = await login(input);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const text = await response.text();
    for (const secret of ["PRIVATE_PASSWORD", "PRIVATE_FIELD", password]) assert.ok(!text.includes(secret));
  }
  assert.equal(await prisma.refreshSession.count(), count);
});

// Last: prior tests intentionally used seven accepted-origin login attempts.
test("the eleventh login attempt gets 429; valid credentials cannot bypass the independent IP quota", async () => {
  const count = await prisma.refreshSession.count();
  for (let remaining = 0; remaining < 3; remaining++) assert.equal((await login({})).status, 400);
  for (const input of [{}, { email: user.email, password }]) {
    const response = await login(input);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(Number(response.headers.get("retry-after")) > 0);
    assert.ok(response.headers.get("ratelimit"));
    assert.deepEqual(await response.json(), { error: { code: "TOO_MANY_REQUESTS", message: "Too many login attempts. Please try again later." } });
  }
  assert.equal(await prisma.refreshSession.count(), count);
  const signup = await globalThis.fetch(`${base}/api/v1/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: env.FRONTEND_ORIGIN }, body: "{}",
  });
  assert.equal(signup.status, 400, "login limiter must not exhaust the signup allowance");
  assert.equal((await globalThis.fetch(`${base}/health`)).status, 200);
  assert.equal((await globalThis.fetch(`${base}/ready`)).status, 200);
});
