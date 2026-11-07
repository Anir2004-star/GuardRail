import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import process from "node:process";
import { after, mock, test } from "node:test";
import { OAuth2Client } from "google-auth-library";
import { SignJWT } from "jose";

process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/unused";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
process.env.GOOGLE_CLIENT_ID = "123456-test.apps.googleusercontent.com";
const { googleClientId, googleHash, verifyGoogleIdentity } = await import("../dist/auth/google-identity.js");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
mock.method(OAuth2Client.prototype, "getFederatedSignonCertsAsync", async () => ({ certs: { test: keys.publicKey.export({ type: "spki", format: "pem" }) } }));
after(() => mock.restoreAll());
const nonce = randomBytes(32).toString("base64url");
const now = Math.floor(Date.now() / 1000);
async function token(overrides = {}, key = keys.privateKey) {
  return new SignJWT({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, sub: "google-stable-subject", iat: now, exp: now + 3600, nonce, email: "Person@gmail.com", email_verified: true, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(key);
}
test("Google verification uses signed subject, verified email, configured audience and browser nonce", async () => {
  const identity = await verifyGoogleIdentity(await token(), googleHash(nonce));
  assert.equal(identity.subject, "google-stable-subject");
  assert.equal(identity.email, "person@gmail.com");
  assert.equal(identity.authoritativeEmail, true);
  assert.equal((await verifyGoogleIdentity(await token({ email: "person@example.org" }), googleHash(nonce))).authoritativeEmail, false);
});
test("wrong signature, issuer, audience, expiry, nonce and claims fail without exposing credentials", async () => {
  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const cases = [await token({}, wrongKey), "invalid.private.credential"];
  for (const override of [{ iss: "https://attacker.invalid" }, { aud: "wrong" }, { exp: now - 1 }, { iat: now + 60 }, { email_verified: false }, { email: "invalid" }, { nonce: randomBytes(32).toString("base64url") }, { sub: "" }, { azp: "wrong" }]) cases.push(await token(override));
  for (const credential of cases) {
    await assert.rejects(verifyGoogleIdentity(credential, googleHash(nonce)), (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.message, "Google sign-in could not be verified. Start again.");
      assert.ok(!error.message.includes(credential));
      return true;
    });
  }
});
test("absent or malformed Google configuration safely disables Google only", () => {
  const value = process.env.GOOGLE_CLIENT_ID;
  for (const candidate of [undefined, "private-invalid-value"]) {
    if (candidate) process.env.GOOGLE_CLIENT_ID = candidate;
    else delete process.env.GOOGLE_CLIENT_ID;
    assert.throws(googleClientId, (error) => error.status === 503 && !error.message.includes("private-invalid-value"));
  }
  process.env.GOOGLE_CLIENT_ID = value;
});
