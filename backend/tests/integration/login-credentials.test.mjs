import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { after, before, test } from "node:test";
import bcrypt from "bcrypt";
import express from "express";

// No development fallback: only the runner's newly created test DB is allowed.
const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);

const { registerUser, verifyLoginCredentials, createLoginAccess } = await import("../../dist/services/auth.service.js");
const { verifyAccessToken } = await import("../../dist/auth/access-tokens.js");
const { InvalidCredentialsError } = await import("../../dist/errors/auth.errors.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { env } = await import("../../dist/config/env.js");
const { validateLogin } = await import("../../dist/middleware/validate-login.js");
const { errorHandler } = await import("../../dist/middleware/error-handler.js");
const password = "  My strong Passphrase!42  ";
let user;
let passwordless;
let server;
let endpoint;
function email() { return `credentials-${randomUUID()}@example.invalid`; }

before(async () => {
  user = await registerUser({ firstName: "Login", lastName: "Tester", email: email(), password });
  passwordless = await prisma.user.create({ data: { email: email(), name: "Temporary legacy account" }, select: { id: true, email: true } });
  const fixture = express();
  fixture.use(express.json());
  // Test-only verifier. The production login route is a later step.
  fixture.post("/verify-login", validateLogin, async (request, response) => {
    response.status(200).json({ user: await verifyLoginCredentials(request.body) });
  });
  fixture.use(errorHandler);
  server = fixture.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${server.address().port}/verify-login`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
});

function request(input) {
  return globalThis.fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

test("registered email and exact password return only the safe profile", async () => {
  const result = await verifyLoginCredentials({ email: ` ${user.email.toUpperCase()} `, password });
  assert.deepEqual(result, user);
  assert.equal("passwordHash" in result, false);
  const response = await request({ email: user.email, password });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.user.id, user.id);
  assert.equal("passwordHash" in body.user, false);
  assert.equal(await prisma.refreshSession.count({ where: { userId: user.id } }), 0);
});

test("wrong passwords, unknown emails and passwordless accounts have identical safe 401 responses", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  const inputs = [
    { email: user.email, password: "Wrong password!42" },
    { email: email(), password },
    { email: passwordless.email, password },
  ];
  for (const input of inputs) {
    const response = await request(input);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body, { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    assert.ok(!JSON.stringify(body).includes(input.email));
    assert.ok(!JSON.stringify(body).includes(input.password));
  }
  assert.equal(logger.mock.calls.length, 0);
});

test("unknown/passwordless accounts compare against the same precomputed bcrypt hash", async (t) => {
  const originalCompare = bcrypt.compare;
  const comparison = t.mock.method(bcrypt, "compare", (value, hash) => originalCompare(value, hash));
  for (const accountEmail of [email(), email(), passwordless.email]) {
    await assert.rejects(verifyLoginCredentials({ email: accountEmail, password }), InvalidCredentialsError);
  }
  assert.equal(comparison.mock.calls.length, 3);
  const hashes = comparison.mock.calls.map((call) => call.arguments[1]);
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
  assert.equal(bcrypt.getRounds(hashes[0]), env.BCRYPT_ROUNDS);
});

test("password whitespace and case are significant", async () => {
  for (const wrongPassword of [password.trim(), password.toLowerCase(), password + " "]) {
    await assert.rejects(verifyLoginCredentials({ email: user.email, password: wrongPassword }), InvalidCredentialsError);
  }
});

test("a different account's password never authenticates the requested email", async () => {
  const otherPassword = "Another strong Passphrase!84";
  const other = await registerUser({ firstName: "Login", lastName: "Tester", email: email(), password: otherPassword });
  await assert.rejects(verifyLoginCredentials({ email: user.email, password: otherPassword }), InvalidCredentialsError);
  await assert.rejects(verifyLoginCredentials({ email: other.email, password }), InvalidCredentialsError);
  assert.equal((await verifyLoginCredentials({ email: other.email, password: otherPassword })).id, other.id);
});

test("malformed login input returns 400 before password comparison or database work", async (t) => {
  const originalCompare = bcrypt.compare;
  const comparison = t.mock.method(bcrypt, "compare", (value, hash) => originalCompare(value, hash));
  const response = await request({ email: "not-an-email", password: "" });
  assert.equal(response.status, 400);
  assert.equal(comparison.mock.calls.length, 0);
});

test("a deleted account cannot pass credential verification", async () => {
  const removed = await registerUser({ firstName: "Temporary", lastName: "User", email: email(), password });
  await prisma.user.delete({ where: { id: removed.id } });
  await assert.rejects(verifyLoginCredentials({ email: removed.email, password }), InvalidCredentialsError);
});

test("access tokens are issued only after successful credential verification", async () => {
  const result = await createLoginAccess({ email: user.email, password });
  assert.deepEqual(result.user, user);
  assert.equal(result.tokenType, "Bearer");
  assert.equal(result.expiresIn, env.ACCESS_TOKEN_TTL_SECONDS);
  assert.equal((await verifyAccessToken(result.accessToken)).userId, user.id);
  assert.equal("passwordHash" in result.user, false);
  assert.equal("refreshToken" in result, false);
  await assert.rejects(createLoginAccess({ email: user.email, password: "Wrong password!42" }), InvalidCredentialsError);
  await assert.rejects(createLoginAccess({ email: email(), password }), InvalidCredentialsError);
  assert.equal(await prisma.refreshSession.count({ where: { userId: user.id } }), 0);
});
