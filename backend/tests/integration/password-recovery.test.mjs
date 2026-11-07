import assert from "node:assert/strict";
import console from "node:console";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";
import { after, before, test } from "node:test";
import bcrypt from "bcrypt";
import { createSmtpInbox, mailText } from "../helpers/smtp-inbox.mjs";

const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
const inbox = await createSmtpInbox();
Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(inbox.port), SMTP_SECURE: "false", SMTP_USER: "", SMTP_PASSWORD: "", MAIL_FROM: "guardrail@example.invalid" });
const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { passwordResetEnv } = await import("../../dist/config/password-reset.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { registerVerifiedUser: registerUser } = await import("../helpers/verified-user.mjs");
const { createLoginSession, verifyLoginCredentials } = await import("../../dist/services/auth.service.js");
const { requestPasswordReset, drainPasswordResetEmails } = await import("../../dist/services/password-reset.service.js");
const { generatePasswordResetToken, hashPasswordResetToken } = await import("../../dist/auth/password-reset-tokens.js");
const password = "  Original reset Passphrase!42  ";
const newPassword = "  Changed reset Passphrase!84  ";
const message = { message: "If an account exists for that email, a password reset link will be sent." };
let server;
let base;
let primary;
let primaryToken;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  primary = await account();
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await drainPasswordResetEmails();
  await disconnectDatabase();
  await inbox.close();
});
function account() { return registerUser({ firstName: "Password", lastName: "Recovery", email: `reset-${randomUUID()}@example.invalid`, password }); }
function post(route, body, headers = {}) {
  return globalThis.fetch(`${base}/api/v1/auth/${route}`, { method: "POST", headers: { Origin: env.FRONTEND_ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function resetMail(email) { return inbox.messages.filter((mail) => mail.recipients.includes(email) && mail.raw.includes("Subject: Reset your Guardrail password")).at(-1); }
function tokenFromMail(mail) {
  assert.ok(mail, "Expected an email in the loopback SMTP capture inbox");
  const url = new URL(mailText(mail).match(/https?:\/\/[^\s]+/)[0]);
  assert.equal(url.origin, env.FRONTEND_ORIGIN);
  assert.equal(url.pathname, "/reset-password");
  assert.equal(url.search, "");
  return new URLSearchParams(url.hash.slice(1)).get("token");
}
async function issue(user) {
  requestPasswordReset({ email: user.email });
  await drainPasswordResetEmails();
  return tokenFromMail(resetMail(user.email));
}
async function invalid(response) {
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code: "INVALID_RESET_TOKEN", message: "Reset link is invalid or expired. Request a new link." } });
}

test("known and unknown reset requests return identical responses; actual SMTP receives only a hash-backed single-use link", async () => {
  const known = await post("forgot-password", { email: ` ${primary.email.toUpperCase()} ` }, { Host: "untrusted.example" });
  const unknown = await post("forgot-password", { email: `unknown-${randomUUID()}@example.invalid` });
  for (const response of [known, unknown]) {
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), message);
  }
  await drainPasswordResetEmails();
  assert.equal(inbox.messages.length, 1);
  primaryToken = tokenFromMail(resetMail(primary.email));
  const row = await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashPasswordResetToken(primaryToken) } });
  assert.equal(row.userId, primary.id);
  assert.equal(row.usedAt, null);
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), passwordResetEnv.ttlSeconds * 1000);
  assert.ok(!JSON.stringify(row).includes(primaryToken));
  assert.equal((await verifyLoginCredentials({ email: primary.email, password })).id, primary.id);
});

test("redeeming the link hashes the unchanged new password, consumes resets and revokes all of that user's refresh families", async () => {
  const sessions = await Promise.all([createLoginSession({ email: primary.email, password }), createLoginSession({ email: primary.email, password })]);
  const other = await account();
  const independent = await createLoginSession({ email: other.email, password });
  const response = await post("reset-password", { token: primaryToken, password: newPassword }, { Cookie: `guardrail_refresh=${sessions[0].refresh.token.value}` });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.ok(response.headers.get("set-cookie").includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"));
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: primary.id } });
  assert.notEqual(stored.passwordHash, newPassword);
  assert.equal(bcrypt.getRounds(stored.passwordHash), env.BCRYPT_ROUNDS);
  assert.ok(await bcrypt.compare(newPassword, stored.passwordHash));
  assert.equal(await bcrypt.compare(newPassword.trim(), stored.passwordHash), false);
  await assert.rejects(verifyLoginCredentials({ email: primary.email, password }));
  assert.equal((await verifyLoginCredentials({ email: primary.email, password: newPassword })).id, primary.id);
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: primary.id, usedAt: null } }), 0);
  assert.equal(await prisma.refreshSession.count({ where: { userId: primary.id, revokedAt: null } }), 0);
  assert.equal((await prisma.refreshSession.findUniqueOrThrow({ where: { id: independent.refresh.sessionId } })).revokedAt, null);
  await drainPasswordResetEmails();
  const notice = inbox.messages.find((mail) => mail.recipients.includes(primary.email) && mail.raw.includes("Subject: Your Guardrail password changed"));
  assert.ok(notice);
  assert.ok(!mailText(notice).includes(newPassword));
});

test("reused, unknown and expired links return the same safe error", async () => {
  await invalid(await post("reset-password", { token: primaryToken, password: newPassword }));
  await invalid(await post("reset-password", { token: generatePasswordResetToken().value, password: newPassword }));
  const user = await account();
  const token = await issue(user);
  await prisma.passwordResetToken.update({ where: { tokenHash: hashPasswordResetToken(token) }, data: { expiresAt: new Date(0) } });
  await invalid(await post("reset-password", { token, password: newPassword }));
  assert.equal((await verifyLoginCredentials({ email: user.email, password })).id, user.id);
});

test("invalid passwords do not consume a valid reset token or alter the account", async () => {
  const user = await account();
  const token = await issue(user);
  const response = await post("reset-password", { token, password: "PRIVATE_WEAK_PASSWORD" });
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.ok(!body.includes(token));
  assert.ok(!body.includes("PRIVATE_WEAK_PASSWORD"));
  assert.equal((await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashPasswordResetToken(token) } })).usedAt, null);
  assert.equal((await verifyLoginCredentials({ email: user.email, password })).id, user.id);
});

test("concurrent redemptions have exactly one winner", async () => {
  const user = await account();
  const token = await issue(user);
  const alternatives = [newPassword, "Another reset Passphrase!67"];
  const responses = await Promise.all(alternatives.map((password) => post("reset-password", { token, password })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [204, 400]);
  const winner = responses.findIndex((response) => response.status === 204);
  assert.equal((await verifyLoginCredentials({ email: user.email, password: alternatives[winner] })).id, user.id);
  await assert.rejects(verifyLoginCredentials({ email: user.email, password: alternatives[1 - winner] }));
});

test("reset racing refresh leaves no usable refresh descendants", async () => {
  const user = await account();
  const token = await issue(user);
  const login = await createLoginSession({ email: user.email, password });
  const [reset, refresh] = await Promise.all([
    post("reset-password", { token, password: newPassword }),
    post("refresh", {}, { Cookie: `guardrail_refresh=${login.refresh.token.value}` }),
  ]);
  assert.equal(reset.status, 204);
  assert.ok([200, 401].includes(refresh.status));
  assert.equal(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
});

test("per-account cooldown prevents repeated mail and a later request invalidates older links", async () => {
  const user = await account();
  const first = await issue(user);
  const count = inbox.messages.length;
  const response = await post("forgot-password", { email: user.email });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), message);
  await drainPasswordResetEmails();
  assert.equal(inbox.messages.length, count);
  await prisma.passwordResetToken.update({ where: { tokenHash: hashPasswordResetToken(first) }, data: { createdAt: new Date(Date.now() - 61_000) } });
  const second = await issue(user);
  assert.notEqual(first, second);
  await invalid(await post("reset-password", { token: first, password: newPassword }));
});

test("SMTP rejection does not reveal account existence and invalidates the undelivered token", async (t) => {
  await drainPasswordResetEmails();
  const logger = t.mock.method(console, "error", () => {});
  const user = await account();
  inbox.rejected.add(user.email);
  const response = await post("forgot-password", { email: user.email });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), message);
  await drainPasswordResetEmails();
  const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
  assert.ok(token.usedAt);
  assert.equal(resetMail(user.email), undefined);
  assert.deepEqual(logger.mock.calls.map((call) => call.arguments), [["Password recovery email processing failed"]]);
});

test("bad input and rejected origins create no tokens or email jobs", async () => {
  await drainPasswordResetEmails();
  const before = await prisma.passwordResetToken.count();
  for (const email of ["invalid", "PRIVATE_BAD_EMAIL"]) assert.equal((await post("forgot-password", { email })).status, 400);
  for (const endpoint of ["forgot-password", "reset-password"]) {
    const response = await post(endpoint, {}, { Origin: "https://unexpected.example" });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  await drainPasswordResetEmails();
  assert.equal(await prisma.passwordResetToken.count(), before);
});

test("recovery endpoint limits are independent and leave health available", async () => {
  await drainPasswordResetEmails();
  const before = await prisma.passwordResetToken.count();
  for (const route of ["forgot-password", "reset-password"]) {
    let limited;
    for (let attempt = 0; attempt <= 20; attempt++) {
      const response = await post(route, {});
      if (response.status === 429) { limited = response; break; }
      assert.equal(response.status, 400);
    }
    assert.ok(limited);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(limited.headers.get("cache-control"), "no-store");
  }
  assert.equal((await post("login", {})).status, 400);
  assert.equal(await prisma.passwordResetToken.count(), before);
  assert.equal((await globalThis.fetch(`${base}/health`)).status, 200);
  assert.equal((await globalThis.fetch(`${base}/ready`)).status, 200);
});
