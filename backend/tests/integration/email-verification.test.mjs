import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { URL, URLSearchParams } from "node:url";
import { after, before, mock, test } from "node:test";
import pg from "pg";
import { createSmtpInbox, mailText } from "../helpers/smtp-inbox.mjs";

const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
const inbox = await createSmtpInbox();
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String(inbox.port);
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = ""; process.env.SMTP_PASSWORD = "";
process.env.MAIL_FROM = "guardrail@example.invalid";
const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerUser, createLoginSession, verifyLoginCredentials } = await import("../../dist/services/auth.service.js");
const { requestEmailVerification, confirmEmailVerification, drainVerificationEmails } = await import("../../dist/services/email-verification.service.js");
const { hashVerificationToken, generateVerificationToken } = await import("../../dist/auth/email-verification.js");
const { createAccessToken } = await import("../../dist/auth/access-tokens.js");
const { createRefreshSession, rotateRefreshSession } = await import("../../dist/services/refresh-session.service.js");
const { resetPassword } = await import("../../dist/services/password-reset.service.js");
let server, base, primary, primaryToken;
const password = "Verify Passphrase!42";
const account = () => registerUser({ firstName: "Verify", lastName: "Tester", email: `verify-${randomUUID()}@example.invalid`, password });
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await drainVerificationEmails(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await disconnectDatabase(); await inbox.close(); mock.restoreAll(); });
function post(path, body, origin = env.FRONTEND_ORIGIN, extra = {}) {
  return globalThis.fetch(`${base}/api/v1/auth/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
}
function message(email) { return inbox.messages.filter((entry) => entry.recipients.includes(email)).at(-1); }
function token(email) {
  const url = new URL(mailText(message(email)).match(/https?:\/\/[^\s]+/)[0]);
  assert.equal(url.origin, env.FRONTEND_ORIGIN);
  assert.equal(url.pathname, "/verify-email"); assert.equal(url.search, "");
  return new URLSearchParams(url.hash.slice(1)).get("token");
}
async function issue(user) { requestEmailVerification({ email: user.email }); await drainVerificationEmails(); return token(user.email); }
const pending = (error) => error.status === 403 && error.code === "EMAIL_NOT_VERIFIED";
const invalid = (error) => error.status === 400 && error.code === "INVALID_VERIFICATION_TOKEN";

test("migration preserves existing rows and access without claiming verified ownership; new rows require verification", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = `verification_migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query('CREATE TABLE "users" ("id" UUID PRIMARY KEY, "name" TEXT)');
    const existing = randomUUID();
    await client.query('INSERT INTO "users" ("id", "name") VALUES ($1, $2)', [existing, "Preserved account"]);
    await client.query(await readFile(new URL("../../prisma/migrations/20261108000100_add_email_verification/migration.sql", import.meta.url), "utf8"));
    const old = (await client.query('SELECT * FROM "users" WHERE "id" = $1', [existing])).rows[0];
    assert.equal(old.name, "Preserved account"); assert.equal(old.email_verified_at, null); assert.equal(old.email_verification_exempt, true);
    const fresh = (await client.query('INSERT INTO "users" ("id") VALUES ($1) RETURNING *', [randomUUID()])).rows[0];
    assert.equal(fresh.email_verified_at, null); assert.equal(fresh.email_verification_exempt, false);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
test("HTTP signup queues a real local verification email, stores only its hash and grants no session", async () => {
  const response = await post("register", { firstName: "New", lastName: "Account", email: `primary-${randomUUID()}@example.invalid`, password }, env.FRONTEND_ORIGIN, { Host: "untrusted.example" });
  assert.equal(response.status, 201);
  const body = await response.json(); primary = body.user;
  assert.equal(body.emailVerificationRequired, true); assert.equal(body.verificationEmailQueued, true);
  assert.equal(response.headers.get("set-cookie"), null);
  await drainVerificationEmails(); primaryToken = token(primary.email);
  const stored = await prisma.user.findUnique({ where: { id: primary.id } });
  assert.equal(stored.emailVerifiedAt, null); assert.equal(stored.emailVerificationExempt, false);
  const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashVerificationToken(primaryToken) } });
  assert.equal(row.userId, primary.id); assert.equal(row.email, primary.email);
  assert.ok(!JSON.stringify(row).includes(primaryToken));
  assert.equal(await prisma.refreshSession.count({ where: { userId: primary.id } }), 0);
});
test("unverified accounts cannot password-login, renew or access private APIs, while incorrect passwords remain generic", async () => {
  await assert.rejects(verifyLoginCredentials({ email: primary.email, password }), pending);
  await assert.rejects(createLoginSession({ email: primary.email, password }), pending);
  const correct = await post("login", { email: primary.email, password });
  assert.equal(correct.status, 403); assert.equal((await correct.json()).error.code, "EMAIL_NOT_VERIFIED");
  assert.equal((await post("login", { email: primary.email, password: "incorrect" })).status, 401);
  const access = await createAccessToken(primary.id);
  const me = await globalThis.fetch(`${base}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${access.accessToken}` } });
  assert.equal(me.status, 403);
  const other = await account();
  const refresh = await prisma.$transaction((transaction) => createRefreshSession(transaction, other.id));
  await assert.rejects(rotateRefreshSession(refresh.token.value), pending);
  assert.equal(await prisma.refreshSession.count({ where: { userId: other.id } }), 1);
});
test("manual token confirmation verifies once, invalidates all unused links and requires separate sign-in", async () => {
  const response = await post("verify-email", { token: primaryToken });
  assert.equal(response.status, 204); assert.equal(await response.text(), "");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(await prisma.refreshSession.count({ where: { userId: primary.id } }), 0);
  const row = await prisma.user.findUnique({ where: { id: primary.id } });
  assert.ok(row.emailVerifiedAt); assert.equal(row.emailVerificationExempt, false);
  await assert.rejects(confirmEmailVerification({ token: primaryToken }), invalid);
  const login = await post("login", { email: primary.email, password });
  assert.equal(login.status, 200); assert.match(login.headers.get("set-cookie"), /guardrail_refresh=/);
  const body = await login.json();
  assert.equal("emailVerificationExempt" in body.user, false);
  assert.equal("emailVerifiedAt" in body.user, false);
});
test("known, unknown, verified and cooldown resends share generic responses; replacements invalidate older links", async () => {
  const user = await account();
  const responses = [];
  for (const email of [user.email.toUpperCase(), `unknown-${randomUUID()}@example.invalid`, primary.email, user.email]) {
    const response = await post("resend-verification", { email }); assert.equal(response.status, 202); responses.push(await response.json());
  }
  responses.forEach((body) => assert.deepEqual(body, responses[0]));
  await drainVerificationEmails();
  const old = token(user.email);
  assert.equal(inbox.messages.filter((entry) => entry.recipients.includes(user.email)).length, 1);
  await prisma.emailVerificationToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 61000) } });
  const replacement = await issue(user);
  assert.notEqual(replacement, old);
  await assert.rejects(confirmEmailVerification({ token: old }), invalid);
  await confirmEmailVerification({ token: replacement });
});
test("expired, changed-email, malformed and wrong-purpose tokens cannot verify an account", async () => {
  const expiredUser = await account(); const expiredToken = await issue(expiredUser);
  await prisma.emailVerificationToken.updateMany({ where: { userId: expiredUser.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(confirmEmailVerification({ token: expiredToken }), invalid);
  const changedUser = await account(); const changedToken = await issue(changedUser);
  await prisma.user.update({ where: { id: changedUser.id }, data: { email: `changed-${randomUUID()}@example.invalid` } });
  await assert.rejects(confirmEmailVerification({ token: changedToken }), invalid);
  await assert.rejects(confirmEmailVerification({ token: generateVerificationToken().value }), invalid);
  await assert.rejects(resetPassword({ token: expiredToken, password: "Another Passphrase!42" }));
  const malformed = await post("verify-email", { token: "PRIVATE_INVALID_TOKEN", password: "PRIVATE_PASSWORD" });
  assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes("PRIVATE_"));
});
test("concurrent confirmation has one winner and does not create login sessions", async () => {
  const user = await account(); const secret = await issue(user);
  const results = await Promise.allSettled([confirmEmailVerification({ token: secret }), confirmEmailVerification({ token: secret })]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(await prisma.emailVerificationToken.count({ where: { userId: user.id, usedAt: null } }), 0);
  assert.equal(await prisma.refreshSession.count({ where: { userId: user.id } }), 0);
});
test("migrated accounts retain password access and may verify voluntarily to remove the exemption", async () => {
  const user = await account();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerificationExempt: true } });
  assert.equal((await createLoginSession({ email: user.email, password })).body.user.id, user.id);
  const secret = await issue(user); await confirmEmailVerification({ token: secret });
  const updated = await prisma.user.findUnique({ where: { id: user.id } });
  assert.ok(updated.emailVerifiedAt); assert.equal(updated.emailVerificationExempt, false);
});
test("SMTP failure retains generic acknowledgement, consumes the undelivered token and logs no sensitive values", async () => {
  const user = await account(); inbox.rejected.add(user.email);
  const logger = mock.method(console, "error", () => {});
  try {
    const response = await post("resend-verification", { email: user.email }); assert.equal(response.status, 202);
    await drainVerificationEmails();
    const tokens = await prisma.emailVerificationToken.findMany({ where: { userId: user.id } });
    assert.equal(tokens.length, 1); assert.ok(tokens[0].usedAt);
    assert.deepEqual(logger.mock.calls.map((call) => call.arguments), [["Email verification processing failed"]]);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).emailVerifiedAt, null);
  } finally { logger.mock.restore(); inbox.rejected.delete(user.email); }
});
test("origin, input validation and independent IP limits protect verification while health stays available", async () => {
  assert.equal((await post("resend-verification", { email: primary.email }, "https://attacker.invalid")).status, 403);
  assert.equal((await post("verify-email", { token: primaryToken }, "")).status, 403);
  const bad = await post("resend-verification", { email: "PRIVATE_INVALID_EMAIL", password: "PRIVATE_PASSWORD" });
  assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes("PRIVATE_"));
  let resend;
  for (let index = 0; index < 12; index++) resend = await post("resend-verification", { email: `unknown-${randomUUID()}@example.invalid` });
  assert.equal(resend.status, 429);
  let confirm;
  for (let index = 0; index < 22; index++) confirm = await post("verify-email", { token: "invalid" });
  assert.equal(confirm.status, 429);
  assert.equal((await globalThis.fetch(`${base}/health`)).status, 200);
  assert.equal((await globalThis.fetch(`${base}/ready`)).status, 200);
});
