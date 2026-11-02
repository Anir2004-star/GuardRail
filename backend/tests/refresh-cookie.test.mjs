import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { test } from "node:test";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/guardrail_test";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
const { REFRESH_COOKIE_NAME, refreshCookieOptions, setRefreshCookie, clearRefreshCookie } = await import("../dist/auth/refresh-cookie.js");
const { generateRefreshToken } = await import("../dist/auth/refresh-tokens.js");
const token = generateRefreshToken().value;

test("cookie policy restricts JavaScript, path and host; production requires HTTPS", () => {
  for (const environment of ["test", "development", "production"]) {
    const options = refreshCookieOptions(environment);
    assert.deepEqual(options, { httpOnly: true, secure: environment === "production", sameSite: "lax", path: "/api/v1/auth" });
    assert.equal("domain" in options, false);
    assert.equal("expires" in options, false);
    assert.equal("maxAge" in options, false);
  }
});

test("HTTP set and clear headers share cookie scope and session expiry", async () => {
  const expiry = new Date(Date.now() + 604800000);
  const fixture = express();
  fixture.get("/set", (_request, response) => {
    setRefreshCookie(response, token, expiry);
    response.status(204).end();
  });
  fixture.get("/clear", (_request, response) => {
    clearRefreshCookie(response);
    response.status(204).end();
  });
  // Exercise production serialization as well as the helper's local defaults.
  fixture.get("/production-policy", (_request, response) => {
    response.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions("production")).status(204).end();
  });
  const server = fixture.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await globalThis.fetch(`${base}/set`);
    const header = response.headers.get("set-cookie");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(header.startsWith(`${REFRESH_COOKIE_NAME}=${token};`));
    assert.ok(header.includes(`Expires=${expiry.toUTCString()}`));
    for (const flag of ["Path=/api/v1/auth", "HttpOnly", "SameSite=Lax"]) assert.ok(header.includes(flag));
    assert.ok(!header.includes("Secure"));
    assert.ok(!header.includes("Domain="));
    assert.ok(!header.includes("Max-Age="));
    const cleared = await globalThis.fetch(`${base}/clear`);
    const clearHeader = cleared.headers.get("set-cookie");
    assert.ok(clearHeader.startsWith(`${REFRESH_COOKIE_NAME}=;`));
    assert.ok(clearHeader.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"));
    for (const flag of ["Path=/api/v1/auth", "HttpOnly", "SameSite=Lax"]) assert.ok(clearHeader.includes(flag));
    assert.equal(cleared.headers.get("cache-control"), "no-store");
    assert.ok((await globalThis.fetch(`${base}/production-policy`)).headers.get("set-cookie").includes("; Secure"));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("invalid tokens and expired/invalid dates cannot set a cookie", () => {
  // Any response access here indicates headers were touched before validation.
  const response = new Proxy({}, { get() { assert.fail("response must remain untouched"); } });
  assert.throws(() => setRefreshCookie(response, "private-invalid-token", new Date(Date.now() + 10000)), /Refresh session is invalid/);
  for (const expiry of [new Date(0), new Date("invalid")]) {
    assert.throws(() => setRefreshCookie(response, token, expiry), /future session expiry/);
  }
});
