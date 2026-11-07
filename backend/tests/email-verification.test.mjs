import assert from "node:assert/strict";
import { inspect } from "node:util";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { test } from "node:test";

process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/unused";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
const { generateVerificationToken, hashVerificationToken, verificationTtl, assertEmailAccess, parseVerificationEmail, parseVerificationToken } = await import("../dist/auth/email-verification.js");
const { hashPasswordResetToken } = await import("../dist/auth/password-reset-tokens.js");
const { hashRefreshToken } = await import("../dist/auth/refresh-tokens.js");

test("verification secrets are random, canonical, private in inspection and separated from reset/refresh tokens", () => {
  const first = generateVerificationToken();
  const second = generateVerificationToken();
  assert.match(first.value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.value, second.value);
  assert.ok(!JSON.stringify({ first }).includes(first.value));
  assert.ok(!inspect(first).includes(first.value));
  const hash = hashVerificationToken(first.value);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, hashPasswordResetToken(first.value));
  assert.notEqual(hash, hashRefreshToken(first.value));
  assert.equal(parseVerificationToken({ token: first.value }), hash);
});
test("malformed tokens and unexpected fields return safe errors without echoing values", () => {
  for (const input of [null, undefined, [], { token: "PRIVATE_INVALID_TOKEN" }, { token: generateVerificationToken().value, privatePassword: "PRIVATE_PASSWORD" }]) {
    assert.throws(() => parseVerificationToken(input), (error) => error.status === 400 && !JSON.stringify(error).includes("PRIVATE_"));
  }
  assert.throws(() => hashVerificationToken("A".repeat(42) + "B"));
  assert.equal(parseVerificationEmail({ email: " Person@Example.ORG " }), "person@example.org");
  assert.throws(() => parseVerificationEmail({ email: "person@example.org", PRIVATE_PASSWORD: true }), (error) => error.name === "InputValidationError" && !JSON.stringify(error).includes("PRIVATE_PASSWORD"));
});
test("pending accounts require verification while verified and explicitly migrated accounts retain access", () => {
  assert.throws(() => assertEmailAccess({ emailVerifiedAt: null, emailVerificationExempt: false }), (error) => error.status === 403 && error.code === "EMAIL_NOT_VERIFIED");
  assertEmailAccess({ emailVerifiedAt: new Date(), emailVerificationExempt: false });
  assertEmailAccess({ emailVerifiedAt: null, emailVerificationExempt: true });
});
test("verification lifetime has bounded configuration independent of password reset", () => {
  assert.equal(verificationTtl({}), 3600);
  assert.equal(verificationTtl({ EMAIL_VERIFICATION_TTL_SECONDS: "300" }), 300);
  for (const value of ["0", "299", "86401", "3600.5", "PRIVATE_INVALID", "Infinity"]) {
    assert.throws(() => verificationTtl({ EMAIL_VERIFICATION_TTL_SECONDS: value }), { message: "Invalid EMAIL_VERIFICATION_TTL_SECONDS: use 300 to 86400 seconds." });
  }
});
