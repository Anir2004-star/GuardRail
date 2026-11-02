import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { test } from "node:test";
import { generateRefreshToken, hashRefreshToken } from "../dist/auth/refresh-tokens.js";
import { InvalidRefreshTokenError } from "../dist/errors/auth.errors.js";

test("refresh tokens contain 32 random bytes in canonical URL-safe form", () => {
  const first = generateRefreshToken().value;
  const second = generateRefreshToken().value;
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first, "base64url").length, 32);
  assert.notEqual(first, second);
  assert.notEqual(hashRefreshToken(first), hashRefreshToken(second));
});

test("lookup hash is deterministic SHA-256 of the exact token", () => {
  const token = generateRefreshToken().value;
  assert.equal(hashRefreshToken(token), createHash("sha256").update(token).digest("hex"));
  assert.match(hashRefreshToken(token), /^[a-f0-9]{64}$/);
});

test("malformed and noncanonical refresh tokens fail without echoing input", () => {
  for (const value of [undefined, null, {}, 42, "", "secret", "A".repeat(44), "A".repeat(42) + "B", " ".repeat(43)]) {
    assert.throws(() => hashRefreshToken(value), (error) => {
      assert.ok(error instanceof InvalidRefreshTokenError);
      assert.equal(error.message, "Refresh session is invalid");
      return true;
    });
  }
});

test("raw refresh secret is omitted from JSON and normal object inspection", () => {
  const secret = generateRefreshToken();
  assert.equal(JSON.stringify({ token: secret }), "{}");
  assert.ok(!inspect(secret).includes(secret.value));
  assert.deepEqual(Object.keys(secret), []);
});
