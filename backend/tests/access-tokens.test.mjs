import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import test from "node:test";
import { SignJWT, jwtVerify } from "jose";
import express from "express";

// Isolated test key: never read a developer's private signing secret.
const key = randomBytes(64);
process.env.JWT_ACCESS_SECRET = key.toString("hex");
process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/guardrail_test";
process.env.NODE_ENV = "test";
process.env.JWT_ISSUER = "guardrail-token-test-api";
process.env.JWT_AUDIENCE = "guardrail-token-test-web";
process.env.ACCESS_TOKEN_TTL_SECONDS = "900";
const { env } = await import("../dist/config/env.js");
const { createAccessToken, verifyAccessToken } = await import("../dist/auth/access-tokens.js");
const { InvalidAccessTokenError } = await import("../dist/errors/auth.errors.js");
const { errorHandler } = await import("../dist/middleware/error-handler.js");
const userId = randomUUID();

function claims() {
  const now = Math.floor(Date.now() / 1000);
  return { sub: userId, iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE, iat: now, exp: now + 900, jti: randomUUID() };
}

function sign(payload, header = { alg: "HS256", typ: "at+jwt" }, signingKey = key) {
  return new SignJWT(payload).setProtectedHeader(header).sign(signingKey);
}

test("access token has the required claims, explicit HS256 type, and configured lifetime", async () => {
  const bundle = await createAccessToken(userId);
  assert.equal(bundle.tokenType, "Bearer");
  assert.equal(bundle.expiresIn, 900);
  assert.ok(Object.isFrozen(bundle));
  const { payload, protectedHeader } = await jwtVerify(bundle.accessToken, key, {
    algorithms: ["HS256"], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
  });
  assert.deepEqual(protectedHeader, { alg: "HS256", typ: "at+jwt" });
  assert.equal(payload.sub, userId);
  assert.equal(payload.iss, env.JWT_ISSUER);
  assert.equal(payload.aud, env.JWT_AUDIENCE);
  assert.equal(payload.exp - payload.iat, 900);
  assert.deepEqual(Object.keys(payload).sort(), ["sub", "iss", "aud", "iat", "exp", "jti"].sort());
  const verified = await verifyAccessToken(bundle.accessToken);
  assert.deepEqual(verified, { userId, issuedAt: payload.iat, expiresAt: payload.exp, tokenId: payload.jti });
  assert.ok(Object.isFrozen(verified));
});

test("each issued access token has a distinct token ID", async () => {
  const [first, second] = await Promise.all([createAccessToken(userId), createAccessToken(userId)]);
  assert.notEqual(first.accessToken, second.accessToken);
  assert.notEqual((await verifyAccessToken(first.accessToken)).tokenId, (await verifyAccessToken(second.accessToken)).tokenId);
});

test("issuing requires a user UUID and never accepts arbitrary profile data", async () => {
  for (const subject of [undefined, null, "", "not-a-uuid", 123, { id: userId }]) {
    await assert.rejects(createAccessToken(subject), /subject must be a user UUID/);
  }
});

test("wrong signatures and altered payloads are rejected", async () => {
  await assert.rejects(verifyAccessToken(await sign(claims(), undefined, randomBytes(64))), InvalidAccessTokenError);
  const { accessToken } = await createAccessToken(userId);
  const [header, payload, signature] = accessToken.split(".");
  const altered = { ...JSON.parse(Buffer.from(payload, "base64url").toString()), sub: randomUUID() };
  const tampered = `${header}.${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`;
  await assert.rejects(verifyAccessToken(tampered), InvalidAccessTokenError);
});

test("algorithm allowlist rejects HS384, HS512 and unsigned tokens", async () => {
  for (const alg of ["HS384", "HS512"]) {
    await assert.rejects(verifyAccessToken(await sign(claims(), { alg, typ: "at+jwt" })), InvalidAccessTokenError);
  }
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", typ: "at+jwt" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims())).toString("base64url")}.`;
  await assert.rejects(verifyAccessToken(unsigned), InvalidAccessTokenError);
});

test("wrong token type, issuer and audience are rejected", async () => {
  await assert.rejects(verifyAccessToken(await sign(claims(), { alg: "HS256", typ: "JWT" })), InvalidAccessTokenError);
  await assert.rejects(verifyAccessToken(await sign({ ...claims(), iss: "another-api" })), InvalidAccessTokenError);
  await assert.rejects(verifyAccessToken(await sign({ ...claims(), aud: "another-app" })), InvalidAccessTokenError);
});

test("expired tokens and future issue times are rejected without sleeping", async () => {
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(verifyAccessToken(await sign({ ...claims(), iat: now - 1000, exp: now - 100 })), InvalidAccessTokenError);
  await assert.rejects(verifyAccessToken(await sign({ ...claims(), iat: now + 100, exp: now + 1000 })), InvalidAccessTokenError);
});

test("every required claim is enforced", async () => {
  for (const name of ["sub", "iss", "aud", "iat", "exp", "jti"]) {
    const payload = claims();
    delete payload[name];
    await assert.rejects(verifyAccessToken(await sign(payload)), InvalidAccessTokenError);
  }
});

test("malformed subjects, token IDs, timestamps and excessive lifetimes are rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const override of [
    { sub: "not-a-user-uuid" }, { jti: "not-a-token-uuid" },
    { iat: now - 0.5 }, { exp: now + 899.5 }, { exp: now }, { exp: now + 901 },
  ]) {
    await assert.rejects(verifyAccessToken(await sign({ ...claims(), ...override })), InvalidAccessTokenError);
  }
});

test("missing, malformed and oversized tokens fail with one generic error", async () => {
  for (const token of [undefined, null, false, 42, {}, [], "", "PRIVATE_INVALID_TOKEN", "x".repeat(4097)]) {
    await assert.rejects(verifyAccessToken(token), (error) => {
      assert.ok(error instanceof InvalidAccessTokenError);
      assert.equal(error.message, "A valid access token is required");
      assert.ok(!error.message.includes("PRIVATE_INVALID_TOKEN"));
      return true;
    });
  }
});

test("token verification errors map to safe HTTP 401 without logging raw credentials", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  const fixture = express();
  fixture.use(express.json());
  fixture.post("/verify", async (request, response) => {
    await verifyAccessToken(request.body.token);
    response.status(204).end();
  });
  fixture.use(errorHandler);
  const server = fixture.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "PRIVATE_INVALID_TOKEN" }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED", message: "A valid access token is required" } });
    assert.equal(logger.mock.calls.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
