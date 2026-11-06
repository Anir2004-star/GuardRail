import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { inspect } from "node:util";
import { test } from "node:test";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/guardrail_test";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
const { generatePasswordResetToken, hashPasswordResetToken } = await import("../dist/auth/password-reset-tokens.js");
const { parseForgotPasswordInput, parseResetPasswordInput, InputValidationError } = await import("../dist/validation/auth.validation.js");
const { validateForgotPassword, validateResetPassword } = await import("../dist/middleware/validate-password-reset.js");
const { errorHandler } = await import("../dist/middleware/error-handler.js");
const { loadPasswordResetEnvironment } = await import("../dist/config/password-reset.js");
const password = "  Reset strong Passphrase!42  ";

test("reset tokens are random, canonical, hidden from JSON/inspection and stored as a purpose-specific hash", () => {
  const first = generatePasswordResetToken();
  assert.match(first.value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.value, generatePasswordResetToken().value);
  assert.equal(hashPasswordResetToken(first.value), createHash("sha256").update(`guardrail:password-reset:${first.value}`).digest("hex"));
  assert.equal(JSON.stringify({ token: first }), "{}");
  assert.ok(!inspect(first).includes(first.value));
});

test("invalid reset token inputs produce safe errors without echoing values", () => {
  for (const value of [undefined, null, {}, "PRIVATE_TOKEN", "A".repeat(42) + "B", "A".repeat(44)]) {
    assert.throws(() => hashPasswordResetToken(value), /Reset link is invalid or expired/);
  }
});

test("recovery validates email and unchanged strong passwords, rejecting unknown fields safely", () => {
  assert.deepEqual(parseForgotPasswordInput({ email: " Person@Example.ORG " }), { email: "person@example.org" });
  const token = generatePasswordResetToken().value;
  assert.deepEqual(parseResetPasswordInput({ token, password }), { token, password });
  for (const input of [{ token, password: "weak" }, { token, password, confirm: password }, { token: "bad", password }, { token, password: "É".repeat(37) + "Aa1!" }]) {
    assert.throws(() => parseResetPasswordInput(input), (error) => {
      assert.ok(error instanceof InputValidationError);
      assert.ok(!JSON.stringify(error).includes(token));
      assert.ok(!JSON.stringify(error).includes(password));
      return true;
    });
  }
});

test("SMTP defaults use a local inbox; production requires explicit sender/host and TLS", () => {
  const local = loadPasswordResetEnvironment({ NODE_ENV: "test" });
  assert.equal(local.port, 1025);
  assert.equal(local.host, "127.0.0.1");
  assert.equal(local.requireTLS, false);
  assert.equal(local.ttlSeconds, 1800);
  const disabled = loadPasswordResetEnvironment({ NODE_ENV: "production" });
  assert.equal(disabled.host, undefined);
  assert.equal(disabled.from, undefined);
  const configured = loadPasswordResetEnvironment({ NODE_ENV: "production", SMTP_HOST: "smtp.example.org", MAIL_FROM: "no-reply@example.org" });
  assert.equal(configured.requireTLS, true);
  assert.equal(configured.port, 587);
});

test("mail configuration bounds and credential pairing errors do not reveal secrets", () => {
  for (const extra of [{ PASSWORD_RESET_TTL_SECONDS: "299" }, { PASSWORD_RESET_TTL_SECONDS: "3601" }, { SMTP_HOST: "https://private.example" }, { SMTP_PORT: "0" }, { SMTP_SECURE: "yes" }, { MAIL_FROM: "bad\r\nheader" }, { SMTP_PASSWORD: "PRIVATE_SMTP_PASSWORD" }]) {
    assert.throws(() => loadPasswordResetEnvironment({ NODE_ENV: "test", ...extra }), (error) => {
      assert.ok(!error.message.includes("PRIVATE_SMTP_PASSWORD"));
      return true;
    });
  }
});

test("invalid recovery HTTP input returns sanitized 400 field errors without passwords or tokens", async () => {
  const app = express();
  app.use(express.json());
  app.post("/forgot", validateForgotPassword, (_request, response) => response.sendStatus(204));
  app.post("/reset", validateResetPassword, (_request, response) => response.sendStatus(204));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    for (const [route, body] of [["forgot", { email: "PRIVATE_BAD_EMAIL" }], ["reset", { token: "PRIVATE_BAD_TOKEN", password: "PRIVATE_BAD_PASSWORD" }]]) {
      const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.ok(!(await response.text()).includes("PRIVATE_"));
    }
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
