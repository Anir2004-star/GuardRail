import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { URL } from "node:url";
import { after, before, mock, test } from "node:test";
import { OAuth2Client } from "google-auth-library";
import { SignJWT } from "jose";

const databaseName = process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE;
assert.equal(process.env.NODE_ENV, "test");
assert.match(databaseName ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, `/${databaseName}`);
assert.notEqual(databaseName, process.env.GUARDRAIL_DEVELOPMENT_DATABASE);
process.env.GOOGLE_CLIENT_ID = "123456-integration.apps.googleusercontent.com";
const { app } = await import("../../dist/app.js");
const { env } = await import("../../dist/config/env.js");
const { prisma, disconnectDatabase } = await import("../../dist/config/database.js");
const { createGoogleChallenge, completeGoogleSignIn } = await import("../../dist/services/google-auth.service.js");
const { registerVerifiedUser: registerUser } = await import("../helpers/verified-user.mjs");
const { verifyLoginCredentials } = await import("../../dist/services/auth.service.js");
const { registerUser: registerPendingUser } = await import("../../dist/services/auth.service.js");
const { verifyAccessToken } = await import("../../dist/auth/access-tokens.js");
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
mock.method(OAuth2Client.prototype, "getFederatedSignonCertsAsync", async () => ({ certs: { test: keys.publicKey.export({ type: "spki", format: "pem" }) } }));
let server, base;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { mock.restoreAll(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await disconnectDatabase(); });
function response() { return { cookies: [], cookie(name, value, options) { this.cookies.push({ name, value, options }); }, clearCookie() {} }; }
async function flow(intent, identity = {}) {
  const res = response();
  const challenge = await createGoogleChallenge({ intent }, res);
  const cookie = res.cookies[0];
  const request = { headers: { cookie: `${cookie.name}=${cookie.value}` } };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, sub: randomUUID(), email: `google-${randomUUID()}@gmail.com`, email_verified: true, iat: now, exp: now + 3600, nonce: challenge.nonce, given_name: "Google", family_name: "User", ...identity };
  const credential = await new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(keys.privateKey);
  return { payload, request, cookie, challenge, data: { intent, credential } };
}
function complete(value, overrides = {}) { return completeGoogleSignIn({ ...value.data, ...overrides }, value.request, response()); }
const rejected = (status) => (error) => error.status === status;

test("explicit Google signup creates a passwordless account and normal safe session; login uses stable subject", async () => {
  const signup = await flow("signup");
  assert.equal(signup.cookie.options.httpOnly, true);
  assert.equal(signup.cookie.options.sameSite, "lax");
  const result = await complete(signup);
  assert.equal(result.body.user.email, signup.payload.email);
  assert.equal("googleSubject" in result.body.user, false);
  assert.equal("passwordHash" in result.body.user, false);
  assert.equal((await verifyAccessToken(result.body.accessToken)).userId, result.body.user.id);
  const stored = await prisma.user.findUnique({ where: { id: result.body.user.id } });
  assert.equal(stored.passwordHash, null);
  assert.equal(stored.googleSubject, signup.payload.sub);
  assert.ok(stored.emailVerifiedAt);
  const login = await flow("login", { sub: signup.payload.sub, email: `changed-${randomUUID()}@gmail.com` });
  assert.equal((await complete(login)).body.user.id, stored.id);
  assert.equal(await prisma.refreshSession.count({ where: { userId: stored.id } }), 2);
  assert.equal((await prisma.user.findUnique({ where: { id: stored.id } })).email, stored.email);
});
test("login cannot register users; matching-email signup/login cannot silently link an existing account", async () => {
  const user = await registerUser({ firstName: "Existing", lastName: "User", email: `existing-${randomUUID()}@gmail.com`, password: "Existing Passphrase!42" });
  const count = await prisma.user.count();
  await assert.rejects(complete(await flow("login")), rejected(409));
  await assert.rejects(complete(await flow("login", { email: user.email })), rejected(409));
  await assert.rejects(complete(await flow("signup", { email: user.email })), rejected(409));
  assert.equal(await prisma.user.count(), count);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).googleSubject, null);
});
test("link requires correct existing password and binds Google subject without changing names or password", async () => {
  const password = "  Existing Passphrase!42  ";
  const user = await registerUser({ firstName: "Keep", lastName: "Names", email: `link-${randomUUID()}@example.org`, password });
  const failed = await flow("link", { email: user.email });
  await assert.rejects(complete(failed, { password: "wrong-password" }));
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).googleSubject, null);
  const link = await flow("link", { email: user.email });
  assert.equal((await complete(link, { password })).body.user.id, user.id);
  assert.equal((await verifyLoginCredentials({ email: user.email, password })).firstName, "Keep");
  assert.equal((await complete(await flow("login", { sub: link.payload.sub, email: user.email }))).body.user.id, user.id);
  await assert.rejects(complete(await flow("link", { email: user.email }), { password }), rejected(401));
});
test("Google linking verifies pending accounts only when Google is authoritative for their matching email", async () => {
  const password = "Pending Password!42";
  const gmail = await registerPendingUser({ firstName: "Pending", lastName: "Gmail", email: `pending-${randomUUID()}@gmail.com`, password });
  const linked = await flow("link", { email: gmail.email });
  assert.equal((await complete(linked, { password })).body.user.id, gmail.id);
  assert.ok((await prisma.user.findUnique({ where: { id: gmail.id } })).emailVerifiedAt);
  const external = await registerPendingUser({ firstName: "Pending", lastName: "External", email: `pending-${randomUUID()}@example.org`, password });
  await assert.rejects(complete(await flow("link", { email: external.email }), { password }), (error) => error.code === "EMAIL_NOT_VERIFIED");
  const unchanged = await prisma.user.findUnique({ where: { id: external.id } });
  assert.equal(unchanged.emailVerifiedAt, null); assert.equal(unchanged.googleSubject, null);
});

test("browser binding, exact intent, expiry, one use and concurrent redemption are enforced", async () => {
  const value = await flow("signup");
  await assert.rejects(completeGoogleSignIn(value.data, { headers: {} }, response()), rejected(401));
  await assert.rejects(completeGoogleSignIn(value.data, { headers: { cookie: `${value.request.headers.cookie}; ${value.request.headers.cookie}` } }, response()), rejected(401));
  await assert.rejects(complete(value, { intent: "login" }), rejected(401));
  const results = await Promise.allSettled([complete(value), complete(value)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  await assert.rejects(complete(value), rejected(401));
  const expired = await flow("signup");
  const { googleHash } = await import("../../dist/auth/google-identity.js");
  await prisma.googleChallenge.update({ where: { secretHash: googleHash(expired.cookie.value) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(complete(expired), rejected(401));
});
test("signup requires additional verification for non-authoritative third-party Google email", async () => {
  const value = await flow("signup", { email: `external-${randomUUID()}@example.org` });
  await assert.rejects(complete(value), rejected(409));
  assert.equal(await prisma.user.count({ where: { email: value.payload.email } }), 0);
});
test("HTTP routes enforce origin, sanitized errors, HttpOnly challenge and refresh cookies, and independent throttling", async () => {
  const post = (path, body, origin = env.FRONTEND_ORIGIN, cookie) => globalThis.fetch(`${base}/api/v1/auth/google/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post("challenge", { intent: "signup" }, "")).status, 403);
  assert.equal((await post("complete", { credential: "PRIVATE_INVALID_CREDENTIAL" }, "https://attacker.invalid")).status, 403);
  const challenge = await post("challenge", { intent: "login" });
  assert.equal(challenge.status, 200);
  assert.match(challenge.headers.get("set-cookie"), /HttpOnly/);
  const signup = await flow("signup");
  const success = await post("complete", signup.data, env.FRONTEND_ORIGIN, signup.request.headers.cookie);
  assert.equal(success.status, 200);
  assert.match(success.headers.get("set-cookie"), /guardrail_refresh=/);
  assert.equal(success.headers.get("cache-control"), "no-store");
  const invalid = await post("complete", { intent: "login", credential: "PRIVATE_INVALID_CREDENTIAL" });
  assert.equal(invalid.status, 401);
  assert.ok(!(await invalid.text()).includes("PRIVATE_INVALID_CREDENTIAL"));
  for (let i = 0; i < 8; i++) await post("complete", {});
  assert.equal((await post("complete", {})).status, 429);
  assert.equal((await globalThis.fetch(`${base}/health`)).status, 200);
});
