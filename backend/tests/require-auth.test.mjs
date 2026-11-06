import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import process from "node:process";
import { after, test } from "node:test";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/guardrail_test";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
const { readBearerToken, requireAuth } = await import("../dist/middleware/require-auth.js");
const { errorHandler } = await import("../dist/middleware/error-handler.js");
const { disconnectDatabase } = await import("../dist/config/database.js");
after(disconnectDatabase);

test("bearer extraction accepts a single header and never considers cookies", () => {
  const value = "abc.def.ghi";
  assert.equal(readBearerToken({ headers: { authorization: `bEaReR  ${value}`, cookie: "guardrail_refresh=ignored" }, rawHeaders: ["Authorization", `bEaReR  ${value}`] }), value);
});

test("missing, duplicate, combined, non-bearer and oversized headers fail uniformly", () => {
  for (const value of [undefined, "", "Basic PRIVATE_SECRET", "Bearer", "Bearer one", "Bearer a.b.c,d.e.f", "Bearer a.b.c trailing", `Bearer ${"x".repeat(4104)}`]) {
    assert.throws(() => readBearerToken({ headers: { authorization: value }, rawHeaders: value === undefined ? [] : ["Authorization", value] }), /A valid access token is required/);
  }
  assert.throws(() => readBearerToken({ headers: { authorization: "Bearer a.b.c" }, rawHeaders: ["Authorization", "Bearer a.b.c", "authorization", "Bearer d.e.f"] }), /A valid access token is required/);
});

test("authentication failures stop the handler and return safe no-store bearer challenges", async () => {
  const app = express();
  let reached = false;
  app.get("/private", requireAuth, (_request, response) => { reached = true; response.end(); });
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    for (const headers of [{}, { Authorization: "Bearer a.b.c" }, { Cookie: "guardrail_refresh=PRIVATE_COOKIE" }]) {
      const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/private`, { headers });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="guardrail"');
      assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED", message: "A valid access token is required" } });
    }
    assert.equal(reached, false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
