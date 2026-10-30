import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { after, before, test } from "node:test";
import bcrypt from "bcrypt";

// Refuse direct execution, missing URLs, or accidental development DB targets.
const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert.equal(databaseUrl.pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);

const { registerUser } = await import("../../dist/services/auth.service.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { env } = await import("../../dist/config/env.js");
const { app } = await import("../../dist/app.js");
const sample = {
  firstName: "Anirban", middleName: "Kumar", lastName: "Roy",
  email: "registration@example.invalid", password: "  My strong Passphrase!42  ",
};
let server;
let endpoint;
let baseUrl;
before(async () => {
  // Run the real app, controller and middleware against only the guarded test DB.
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  endpoint = `${baseUrl}/api/v1/auth/register`;
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await disconnectDatabase();
});
function request(body) {
  return globalThis.fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: env.FRONTEND_ORIGIN }, body: JSON.stringify(body),
  });
}
function email() { return `test-${randomUUID()}@example.invalid`; }

test("registration stores a bcrypt hash and returns only safe profile fields", async (t) => {
  const input = { ...sample, firstName: " Anirban ", email: `  ${email().toUpperCase()}  ` };
  const started = performance.now();
  const user = await registerUser(input);
  t.diagnostic(`Validation, bcrypt work factor ${env.BCRYPT_ROUNDS}, and database insertion: ${Math.round(performance.now() - started)} ms.`);
  assert.deepEqual(Object.keys(user).sort(), ["id", "name", "firstName", "middleName", "lastName", "email", "createdAt"].sort());
  assert.equal(user.name, "Anirban Kumar Roy");
  assert.equal(user.email, input.email.trim().toLowerCase());
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(stored.passwordHash && stored.passwordHash !== input.password);
  assert.equal(stored.passwordHash.length, 60);
  assert.equal(bcrypt.getRounds(stored.passwordHash), env.BCRYPT_ROUNDS);
  assert.ok(await bcrypt.compare(input.password, stored.passwordHash));
  assert.equal(await bcrypt.compare(input.password.trim(), stored.passwordHash), false);
  assert.equal(await prisma.refreshSession.count({ where: { userId: user.id } }), 0);
});

test("normalized duplicate emails receive HTTP 409 using the real Prisma database error", async () => {
  const registeredEmail = email();
  const first = await request({ ...sample, email: registeredEmail });
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const { user } = await first.json();
  assert.deepEqual(Object.keys(user).sort(), ["id", "name", "firstName", "middleName", "lastName", "email", "createdAt"].sort());
  assert.equal(user.email, registeredEmail);
  assert.equal(await prisma.refreshSession.count({ where: { userId: user.id } }), 0);
  const duplicate = await request({ ...sample, email: ` ${registeredEmail.toUpperCase()} ` });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.headers.get("cache-control"), "no-store");
  assert.deepEqual(await duplicate.json(), { error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists." } });
  assert.equal(await prisma.user.count({ where: { email: registeredEmail } }), 1);
});

test("simultaneous duplicate registrations create exactly one user", async () => {
  const registeredEmail = email();
  const responses = await Promise.all([
    request({ ...sample, email: registeredEmail }),
    request({ ...sample, email: registeredEmail.toUpperCase() }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await prisma.user.count({ where: { email: registeredEmail } }), 1);
});

test("different emails may share names and passwords, but receive different salted hashes", async () => {
  const users = await Promise.all([
    registerUser({ ...sample, middleName: "", email: email() }),
    registerUser({ ...sample, middleName: "", email: email() }),
  ]);
  assert.notEqual(users[0].id, users[1].id);
  assert.equal(users[0].middleName, null);
  assert.equal(users[0].name, "Anirban Roy");
  const stored = await prisma.user.findMany({ where: { id: { in: users.map((user) => user.id) } } });
  assert.notEqual(stored[0].passwordHash, stored[1].passwordHash);
});

test("invalid input never creates records or exposes the submitted password", async () => {
  const beforeCount = await prisma.user.count();
  const password = "PRIVATE_INVALID_PASSWORD";
  const response = await request({ ...sample, email: email(), password });
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes(password));
  await assert.rejects(registerUser({ ...sample, firstName: "", email: email() }));
  assert.equal(await prisma.user.count(), beforeCount);
});

test("the database rejects unnormalized emails even when validation is bypassed", async () => {
  await assert.rejects(prisma.user.create({ data: { email: ` ${email().toUpperCase()} ` } }));
});

test("missing and unexpected origins are rejected without creating users", async () => {
  const beforeCount = await prisma.user.count();
  for (const origin of [undefined, "https://untrusted.example", "null", `${env.FRONTEND_ORIGIN}/`]) {
    const headers = { "Content-Type": "application/json" };
    if (origin !== undefined) headers.Origin = origin;
    const response = await globalThis.fetch(endpoint, {
      method: "POST", headers, body: JSON.stringify({ ...sample, email: email() }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed." } });
    if (origin !== undefined) assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  assert.equal(await prisma.user.count(), beforeCount);
});

test("allowed CORS preflight succeeds without creating an account", async () => {
  const beforeCount = await prisma.user.count();
  const response = await globalThis.fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: env.FRONTEND_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), env.FRONTEND_ORIGIN);
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.equal(await prisma.user.count(), beforeCount);
});

test("health and readiness still work with the connected auth router", async () => {
  const health = await globalThis.fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", message: "Guardrail backend is running" });
  const ready = await globalThis.fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready", database: "connected" });
});

// Run last: exhausting the real limiter must not block earlier signup checks.
test("registration returns 429 after the IP limit and leaves health available", async () => {
  const beforeCount = await prisma.user.count();
  let limited;
  for (let attempt = 0; attempt <= 10; attempt++) {
    const response = await request({});
    if (response.status === 429) {
      limited = response;
      break;
    }
    assert.equal(response.status, 400);
  }
  assert.ok(limited, "Expected the registration limiter to reject repeated requests");
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.deepEqual(await limited.json(), { error: { code: "TOO_MANY_REQUESTS", message: "Too many registration attempts. Please try again later." } });
  assert.equal((await request({ ...sample, email: email() })).status, 429);
  assert.equal(await prisma.user.count(), beforeCount);
  assert.equal((await globalThis.fetch(`${baseUrl}/health`)).status, 200);
});
