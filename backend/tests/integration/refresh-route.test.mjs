import assert from "node:assert/strict";
import console from "node:console";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
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
const { createLoginSession } = await import("../../dist/services/auth.service.js");
const { generateRefreshToken, hashRefreshToken } = await import("../../dist/auth/refresh-tokens.js");
const { verifyAccessToken } = await import("../../dist/auth/access-tokens.js");
const { REFRESH_COOKIE_NAME } = await import("../../dist/auth/refresh-cookie.js");
const password = "Refresh route Passphrase!42";
let user;
let server;
let base;
let endpoint;

before(async () => {
  user = await registerUser({ firstName: "Refresh", lastName: "Route", email: `refresh-route-${randomUUID()}@example.invalid`, password });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  endpoint = `${base}/api/v1/auth/refresh`;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
});

function request(token, options = {}) {
  const headers = { Origin: env.FRONTEND_ORIGIN, ...options.headers };
  if (token !== undefined) headers.Cookie = `${REFRESH_COOKIE_NAME}=${token}`;
  return globalThis.fetch(endpoint, { method: "POST", ...options, headers });
}
function cookieToken(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie?.startsWith(`${REFRESH_COOKIE_NAME}=`));
  return cookie.split(";")[0].slice(REFRESH_COOKIE_NAME.length + 1);
}
async function invalid(response) {
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code: "INVALID_REFRESH_TOKEN", message: "Refresh session is invalid" } });
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie.startsWith(`${REFRESH_COOKIE_NAME}=;`));
  for (const flag of ["Path=/api/v1/auth", "HttpOnly", "SameSite=Lax", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"]) assert.ok(cookie.includes(flag));
}
function startSession(account = user) { return createLoginSession({ email: account.email, password }); }

test("public login cookie rotates twice with new access tokens and the original family deadline", async () => {
  const login = await globalThis.fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { Origin: env.FRONTEND_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password }),
  });
  assert.equal(login.status, 200);
  let previousToken = cookieToken(login);
  let previousAccess = (await login.json()).accessToken;
  const root = await prisma.refreshSession.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(previousToken) } });
  let previousId = root.id;
  for (let rotation = 0; rotation < 2; rotation++) {
    const response = await request(previousToken);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), env.FRONTEND_ORIGIN);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    const token = cookieToken(response);
    assert.notEqual(token, previousToken);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ["accessToken", "expiresIn", "tokenType", "user"]);
    assert.equal(body.user.id, user.id);
    assert.equal(body.tokenType, "Bearer");
    assert.equal(body.expiresIn, env.ACCESS_TOKEN_TTL_SECONDS);
    assert.equal((await verifyAccessToken(body.accessToken)).userId, user.id);
    assert.notEqual((await verifyAccessToken(body.accessToken)).tokenId, (await verifyAccessToken(previousAccess)).tokenId);
    for (const secret of [token, previousToken, password, "passwordHash", "tokenHash"]) assert.ok(!JSON.stringify(body).includes(secret));
    const child = await prisma.refreshSession.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(token) } });
    assert.equal(child.familyId, root.familyId);
    assert.equal(child.expiresAt.getTime(), root.expiresAt.getTime());
    assert.equal(child.revokedAt, null);
    assert.equal(child.replacedById, null);
    assert.ok(response.headers.get("set-cookie").includes(`Expires=${root.expiresAt.toUTCString()}`));
    const predecessor = await prisma.refreshSession.findUniqueOrThrow({ where: { id: previousId } });
    assert.ok(predecessor.revokedAt);
    assert.equal(predecessor.replacedById, child.id);
    previousToken = token;
    previousAccess = body.accessToken;
    previousId = child.id;
  }
});

test("missing, malformed, unknown and duplicate cookies fail uniformly without creating sessions", async () => {
  const count = await prisma.refreshSession.count();
  const token = generateRefreshToken().value;
  await invalid(await request(undefined));
  await invalid(await request("PRIVATE_INVALID_TOKEN"));
  await invalid(await request(token));
  await invalid(await request(undefined, { headers: { Cookie: `${REFRESH_COOKIE_NAME}=${token}; ${REFRESH_COOKIE_NAME}=${token}` } }));
  await invalid(await request(undefined, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: token }) }));
  assert.equal(await prisma.refreshSession.count(), count);
});

test("expired and explicitly revoked sessions cannot refresh", async () => {
  for (const data of [{ expiresAt: new Date(0) }, { revokedAt: new Date() }]) {
    const session = await startSession();
    await prisma.refreshSession.update({ where: { id: session.refresh.sessionId }, data });
    const count = await prisma.refreshSession.count();
    await invalid(await request(session.refresh.token.value));
    assert.equal(await prisma.refreshSession.count(), count);
  }
});

test("ancestor reuse commits revocation of all descendants while another login family remains usable", async () => {
  const root = await startSession();
  const independent = await startSession();
  const first = await request(root.refresh.token.value);
  assert.equal(first.status, 200);
  const childToken = cookieToken(first);
  const second = await request(childToken);
  assert.equal(second.status, 200);
  const latestToken = cookieToken(second);
  await invalid(await request(root.refresh.token.value));
  const family = await prisma.refreshSession.findMany({ where: { familyId: root.refresh.familyId } });
  assert.equal(family.length, 3);
  assert.ok(family.every((row) => row.revokedAt !== null));
  await invalid(await request(latestToken));
  assert.equal((await request(independent.refresh.token.value)).status, 200);
});

test("simultaneous use of one refresh token creates one successor and revokes it on reuse", async () => {
  const root = await startSession();
  const responses = await Promise.all([request(root.refresh.token.value), request(root.refresh.token.value)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  const winner = responses.find((response) => response.status === 200);
  const rejected = responses.find((response) => response.status === 401);
  await invalid(rejected);
  const family = await prisma.refreshSession.findMany({ where: { familyId: root.refresh.familyId } });
  assert.equal(family.length, 2);
  assert.ok(family.every((row) => row.revokedAt !== null));
  await invalid(await request(cookieToken(winner)));
});

test("ancestor replay racing descendant rotation leaves no usable descendant", async () => {
  const root = await startSession();
  const first = await request(root.refresh.token.value);
  assert.equal(first.status, 200);
  const [replay, rotation] = await Promise.all([request(root.refresh.token.value), request(cookieToken(first))]);
  await invalid(replay);
  assert.ok([200, 401].includes(rotation.status));
  if (rotation.status === 401) await invalid(rotation);
  const family = await prisma.refreshSession.findMany({ where: { familyId: root.refresh.familyId } });
  assert.ok(family.every((row) => row.revokedAt !== null));
});

test("deleted accounts cannot refresh their former session", async () => {
  const removed = await registerUser({ firstName: "Deleted", lastName: "Tester", email: `deleted-refresh-${randomUUID()}@example.invalid`, password });
  const session = await startSession(removed);
  await prisma.user.delete({ where: { id: removed.id } });
  await invalid(await request(session.refresh.token.value));
  assert.equal(await prisma.refreshSession.count({ where: { userId: removed.id } }), 0);
});

test("signing failure rolls back rotation without clearing the current cookie or logging secrets", async (t) => {
  const root = await startSession();
  const count = await prisma.refreshSession.count();
  const logger = t.mock.method(console, "error", () => {});
  const signer = t.mock.method(SignJWT.prototype, "sign", async () => { throw new Error("PRIVATE_SIGNING_DETAIL"); });
  const response = await request(root.refresh.token.value);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } });
  assert.equal(await prisma.refreshSession.count(), count);
  const unchanged = await prisma.refreshSession.findUniqueOrThrow({ where: { id: root.refresh.sessionId } });
  assert.equal(unchanged.revokedAt, null);
  assert.equal(unchanged.replacedById, null);
  assert.deepEqual(logger.mock.calls.map((call) => call.arguments), [["Unexpected request error"]]);
  signer.mock.restore();
  assert.equal((await request(root.refresh.token.value)).status, 200);
});

test("origin rejection and CORS preflight never rotate, revoke or clear cookies", async () => {
  const root = await startSession();
  const count = await prisma.refreshSession.count();
  for (const origin of [null, "null", "https://unexpected.example", `${env.FRONTEND_ORIGIN}/`]) {
    const headers = { Cookie: `${REFRESH_COOKIE_NAME}=${root.refresh.token.value}` };
    if (origin !== null) headers.Origin = origin;
    const response = await globalThis.fetch(endpoint, { method: "POST", headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("ratelimit"), null);
  }
  const preflight = await globalThis.fetch(endpoint, {
    method: "OPTIONS", headers: { Origin: env.FRONTEND_ORIGIN, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  assert.equal(preflight.headers.get("set-cookie"), null);
  assert.equal(await prisma.refreshSession.count(), count);
  assert.equal((await prisma.refreshSession.findUniqueOrThrow({ where: { id: root.refresh.sessionId } })).revokedAt, null);
});

// Last: quota exhaustion must not block any preceding refresh checks.
test("refresh throttling is independent of login/signup and leaves health available", async () => {
  const root = await startSession();
  const count = await prisma.refreshSession.count();
  let limited;
  for (let attempt = 0; attempt <= 30; attempt++) {
    const response = await request(undefined);
    if (response.status === 429) { limited = response; break; }
    await invalid(response);
  }
  assert.ok(limited);
  assert.equal(limited.headers.get("set-cookie"), null);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.deepEqual(await limited.json(), { error: { code: "TOO_MANY_REQUESTS", message: "Too many session refresh attempts. Please try again later." } });
  assert.equal((await request(root.refresh.token.value)).status, 429);
  assert.equal(await prisma.refreshSession.count(), count);
  assert.equal((await prisma.refreshSession.findUniqueOrThrow({ where: { id: root.refresh.sessionId } })).revokedAt, null);
  for (const route of ["login", "register"]) {
    const response = await globalThis.fetch(`${base}/api/v1/auth/${route}`, {
      method: "POST", headers: { Origin: env.FRONTEND_ORIGIN, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 400);
  }
  assert.equal((await globalThis.fetch(`${base}/health`)).status, 200);
  assert.equal((await globalThis.fetch(`${base}/ready`)).status, 200);
});
