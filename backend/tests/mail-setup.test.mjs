import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import process from "node:process";
import test from "node:test";
import { createSmtpInbox, mailText } from "./helpers/smtp-inbox.mjs";

process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/unused";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
const { loadPasswordResetEnvironment } = await import("../dist/config/password-reset.js");
const { parseMailCommand, assertRealMailConfiguration, mailFailureMessage } = await import("../dist/mail/diagnostics.js");
const gmail = { NODE_ENV: "development", SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "sender@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop", MAIL_FROM: "sender@gmail.com" };

test("Gmail setup accepts grouped App Passwords and enforces authenticated TLS and matching sender", () => {
  const configured = loadPasswordResetEnvironment(gmail);
  assert.equal(configured.password, "abcdefghijklmnop");
  assert.equal(configured.requireTLS, true); assert.equal(configured.secure, false);
  assertRealMailConfiguration(configured);
  const tls = loadPasswordResetEnvironment({ ...gmail, SMTP_PORT: "465", SMTP_SECURE: "true" });
  assert.equal(tls.secure, true);
  const nonGoogle = loadPasswordResetEnvironment({ ...gmail, SMTP_HOST: "smtp.example.org", SMTP_PASSWORD: " keep spaces " });
  assert.equal(nonGoogle.password, " keep spaces ");
});
test("invalid Gmail sender, App Password, port and TLS pair fail without revealing submitted settings", () => {
  for (const change of [{ SMTP_PASSWORD: "PRIVATE_SHORT" }, { SMTP_USER: "PRIVATE_INVALID" }, { MAIL_FROM: "other@example.org" }, { SMTP_PORT: "465", SMTP_SECURE: "false" }, { SMTP_PORT: "587", SMTP_SECURE: "true" }]) {
    assert.throws(() => loadPasswordResetEnvironment({ ...gmail, ...change }), (error) => {
      assert.ok(!error.message.includes("PRIVATE_"));
      assert.ok(!error.message.includes("sender@gmail.com"));
      assert.ok(!error.message.includes("other@example.org"));
      return true;
    });
  }
});
test("mail diagnostics require an explicit valid recipient and cannot accidentally send from verification mode", () => {
  assert.deepEqual(parseMailCommand(["verify"]), { mode: "verify" });
  assert.deepEqual(parseMailCommand(["test", "--to", " Person@Example.ORG "]), { mode: "test", recipient: "person@example.org" });
  for (const args of [[], ["test"], ["verify", "--to", "person@example.org"], ["test", "--to", "PRIVATE_INVALID"], ["test", "--to", "person@example.org", "extra"]]) {
    assert.throws(() => parseMailCommand(args), (error) => !error.message.includes("PRIVATE_INVALID"));
  }
});
test("real delivery readiness refuses local Mailpit, missing credentials, invalid senders and plaintext SMTP", () => {
  assert.throws(() => assertRealMailConfiguration(loadPasswordResetEnvironment({ NODE_ENV: "test" })), /Local Mailpit/);
  const configured = loadPasswordResetEnvironment(gmail);
  assert.throws(() => assertRealMailConfiguration({ ...configured, password: undefined }));
  assert.throws(() => assertRealMailConfiguration({ ...configured, from: "sender@example.invalid" }));
  assert.throws(() => assertRealMailConfiguration({ ...configured, secure: false, requireTLS: false }));
});
test("SMTP diagnostics sanitize raw authentication, connection, TLS and provider errors", () => {
  for (const code of ["EAUTH", "ENOTFOUND", "ESOCKET", "ETLS", "ERR_TLS_CERT_ALTNAME_INVALID", "EENVELOPE", "UNKNOWN"]) {
    const error = Object.assign(new Error("PRIVATE_PASSWORD private-sender@example.org"), { code, response: "PRIVATE_SERVER_RESPONSE" });
    const text = mailFailureMessage(error);
    assert.ok(!text.includes("PRIVATE_")); assert.ok(!text.includes("private-sender"));
    assert.ok(text.length > 0);
  }
});
test("the actual mail CLI catches invalid configuration without printing secrets or a stack trace", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execute = promisify(execFile);
  await assert.rejects(execute(process.execPath, ["dist/cli/mail.js", "verify"], {
    cwd: process.cwd(), timeout: 15000,
    env: { ...process.env, SMTP_HOST: "https://PRIVATE_SMTP_SECRET.invalid", SMTP_USER: "", SMTP_PASSWORD: "" },
  }), (error) => {
    assert.equal(error.code, 1);
    assert.ok(!error.stderr.includes("PRIVATE_SMTP_SECRET"));
    assert.ok(!error.stderr.includes(" at "));
    assert.match(error.stderr, /SMTP setup or operation failed/);
    return true;
  });
});
test("shared SMTP verification sends no message; an explicit test message is delivered only to the loopback capture inbox", async () => {
  const inbox = await createSmtpInbox();
  Object.assign(process.env, { NODE_ENV: "test", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(inbox.port), SMTP_SECURE: "false", SMTP_USER: "", SMTP_PASSWORD: "", MAIL_FROM: "sender@example.invalid" });
  try {
    // The environment module may already be cached by the configuration tests;
    // the shared sender reads passwordResetEnv, so supply the local config using
    // a fresh subprocess with explicit loopback-only settings.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execute = promisify(execFile);
    await execute(process.execPath, ["--input-type=module", "-e", "const {verifyAccountMailTransport,sendAccountMail}=await import('./dist/services/account-mail.service.js');await verifyAccountMailTransport();console.log('verified');"], { cwd: process.cwd(), env: process.env, timeout: 15000 });
    assert.equal(inbox.messages.length, 0);
    await execute(process.execPath, ["--input-type=module", "-e", "const {sendAccountMail}=await import('./dist/services/account-mail.service.js');await sendAccountMail('recipient@example.invalid','Guardrail local test','Local-only test message');"], { cwd: process.cwd(), env: process.env, timeout: 15000 });
    assert.equal(inbox.messages.length, 1);
    assert.deepEqual(inbox.messages[0].recipients, ["recipient@example.invalid"]);
    assert.equal(mailText(inbox.messages[0]).trim(), "Local-only test message");
  } finally { await inbox.close(); }
});
