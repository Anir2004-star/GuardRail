import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import process from "node:process";
import { after, before, test } from "node:test";
import bcrypt from "bcrypt";
import express from "express";

const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);

const { registerVerifiedUser: registerUser } = await import("../helpers/verified-user.mjs");
const { createLoginSession } = await import("../../dist/services/auth.service.js");
const { createRefreshSession } = await import("../../dist/services/refresh-session.service.js");
const { hashRefreshToken } = await import("../../dist/auth/refresh-tokens.js");
const { verifyAccessToken } = await import("../../dist/auth/access-tokens.js");
const { InvalidCredentialsError } = await import("../../dist/errors/auth.errors.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { env } = await import("../../dist/config/env.js");
const { loginController } = await import("../../dist/controllers/auth.controller.js");
const { requireAuthOrigin } = await import("../../dist/middleware/require-auth-origin.js");
const { validateLogin } = await import("../../dist/middleware/validate-login.js");
const { errorHandler } = await import("../../dist/middleware/error-handler.js");
const { REFRESH_COOKIE_NAME } = await import("../../dist/auth/refresh-cookie.js");
const password = "Refresh session Passphrase!42";
let user;
let server;
let endpoint;
before(async () => {
  user = await registerUser({ firstName: "Refresh", lastName: "Tester", email: `refresh-${randomUUID()}@example.invalid`, password });
  const fixture = express();
  fixture.use(express.json());
  // Test-only route: production login wiring remains a separate step.
  fixture.post("/login", requireAuthOrigin, validateLogin, loginController);
  fixture.use(errorHandler);
  server = fixture.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${server.address().port}/login`;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
});

function login(input, origin = env.FRONTEND_ORIGIN) {
  return globalThis.fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(input),
  });
}

test("login controller sets the refresh cookie matching its database session and returns safe JSON", async () => {
  const response = await login({ email: user.email, password });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const header = response.headers.get("set-cookie");
  assert.ok(header.startsWith(`${REFRESH_COOKIE_NAME}=`));
  const rawToken = header.split(";")[0].slice(REFRESH_COOKIE_NAME.length + 1);
  const row = await prisma.refreshSession.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(rawToken) } });
  assert.equal(row.userId, user.id);
  assert.ok(header.includes(`Expires=${row.expiresAt.toUTCString()}`));
  for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/api/v1/auth"]) assert.ok(header.includes(flag));
  assert.ok(!header.includes("Domain="));
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["accessToken", "expiresIn", "tokenType", "user"]);
  assert.equal((await verifyAccessToken(body.accessToken)).userId, user.id);
  assert.ok(!JSON.stringify(body).includes(rawToken));
  assert.equal("passwordHash" in body.user, false);
});

test("failed credentials or invalid input set no cookie and create no session", async () => {
  const count = await prisma.refreshSession.count();
  for (const [input, status] of [
    [{ email: user.email, password: "Wrong password!42" }, 401],
    [{ email: `unknown-${randomUUID()}@example.invalid`, password }, 401],
    [{ email: "invalid", password: "" }, 400],
  ]) {
    const response = await login(input);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(await prisma.refreshSession.count(), count);
});

test("origin middleware rejects cookie login from an unexpected origin", async () => {
  const count = await prisma.refreshSession.count();
  const response = await login({ email: user.email, password }, "https://unexpected.example");
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await prisma.refreshSession.count(), count);
});

test("successful login stores only a token hash with a fixed session lifetime", async () => {
  const result = await createLoginSession({ email: user.email, password });
  assert.deepEqual(result.body.user, user);
  assert.deepEqual(Object.keys(result.body).sort(), ["accessToken", "expiresIn", "tokenType", "user"]);
  assert.equal((await verifyAccessToken(result.body.accessToken)).userId, user.id);
  const row = await prisma.refreshSession.findUniqueOrThrow({ where: { id: result.refresh.sessionId } });
  assert.equal(row.userId, user.id);
  assert.equal(row.tokenHash, hashRefreshToken(result.refresh.token.value));
  assert.notEqual(row.tokenHash, result.refresh.token.value);
  assert.equal(row.familyId, row.id);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), env.REFRESH_SESSION_TTL_SECONDS * 1000);
  assert.equal(row.expiresAt.getTime(), result.refresh.expiresAt.getTime());
  assert.equal(row.revokedAt, null);
  assert.equal(row.replacedById, null);
  assert.ok(!JSON.stringify(row).includes(result.refresh.token.value));
  assert.ok(!JSON.stringify(result).includes(result.refresh.token.value));
  assert.ok(!JSON.stringify(result).includes("passwordHash"));
});

test("separate logins get independent tokens and families without extending old sessions", async () => {
  const first = await createLoginSession({ email: user.email, password });
  const second = await createLoginSession({ email: user.email, password });
  assert.notEqual(first.refresh.token.value, second.refresh.token.value);
  assert.notEqual(first.refresh.familyId, second.refresh.familyId);
  const row = await prisma.refreshSession.findUniqueOrThrow({ where: { id: first.refresh.sessionId } });
  assert.equal(row.expiresAt.getTime(), first.refresh.expiresAt.getTime());
});

test("wrong, unknown and passwordless logins create no sessions", async () => {
  const legacy = await prisma.user.create({ data: { email: `legacy-${randomUUID()}@example.invalid` } });
  const count = await prisma.refreshSession.count();
  for (const input of [
    { email: user.email, password: "Wrong password!42" },
    { email: `unknown-${randomUUID()}@example.invalid`, password },
    { email: legacy.email, password },
  ]) await assert.rejects(createLoginSession(input), InvalidCredentialsError);
  assert.equal(await prisma.refreshSession.count(), count);
});

test("session creation rolls back if its enclosing login transaction fails", async () => {
  const count = await prisma.refreshSession.count();
  await assert.rejects(prisma.$transaction(async (transaction) => {
    await createRefreshSession(transaction, user.id);
    throw new Error("Deliberate test rollback");
  }), /Deliberate test rollback/);
  assert.equal(await prisma.refreshSession.count(), count);
});

test("password changes during verification prevent creation of a stale login session", async (t) => {
  const account = await registerUser({ firstName: "Changing", lastName: "Password", email: `changing-${randomUUID()}@example.invalid`, password });
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
  const replacementHash = await bcrypt.hash("Replacement Passphrase!84", env.BCRYPT_ROUNDS);
  const compare = bcrypt.compare;
  t.mock.method(bcrypt, "compare", async (value, hash) => {
    const matches = await compare(value, hash);
    if (hash === stored.passwordHash && matches) {
      await prisma.user.update({ where: { id: account.id }, data: { passwordHash: replacementHash } });
    }
    return matches;
  });
  await assert.rejects(createLoginSession({ email: account.email, password }), InvalidCredentialsError);
  assert.equal(await prisma.refreshSession.count({ where: { userId: account.id } }), 0);
});
