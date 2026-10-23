import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { randomBytes } from "node:crypto";

// Tests must not depend on a developer's private signing secret.
const testSecret = randomBytes(32).toString("hex");
process.env.JWT_ACCESS_SECRET = testSecret;

// A TCP server that accepts connections but never answers PostgreSQL handshakes.
// This checks driver timeouts without contacting or modifying a real database.
test("unresponsive database has bounded readiness failure while health stays available", async () => {
  const sockets = new Set();
  const stalledDatabase = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  stalledDatabase.listen(0, "127.0.0.1");
  await once(stalledDatabase, "listening");
  process.env.DATABASE_URL = `postgresql://test:private_test_password@127.0.0.1:${stalledDatabase.address().port}/test`;
  process.env.NODE_ENV = "test";

  const { app } = await import("../dist/app.js");
  const { disconnectDatabase } = await import("../dist/config/database.js");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const started = Date.now();
    const pendingReadiness = fetch(`${base}/ready`, { signal: AbortSignal.timeout(8_000) });
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", message: "Guardrail backend is running" });
    const ready = await pendingReadiness;
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), { status: "not_ready", database: "unavailable" });
    assert.equal(ready.headers.get("cache-control"), "no-store");
    assert.ok(Date.now() - started < 8_000);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => stalledDatabase.close(resolve));
  }
});

test("environment validation rejects missing/non-PostgreSQL URLs without revealing credentials", async () => {
  const { loadEnvironment } = await import("../dist/config/env.js");
  for (const DATABASE_URL of [undefined, "", "https://user:secret@localhost/db", "postgresql://localhost"]) {
    assert.throws(() => loadEnvironment({ DATABASE_URL }), (error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  }
  const DATABASE_URL = "postgresql://user:secret@localhost:5433/guardrail?schema=public";
  assert.equal(loadEnvironment({ DATABASE_URL, JWT_ACCESS_SECRET: testSecret }).DATABASE_URL, DATABASE_URL);
  assert.throws(() => loadEnvironment({ DATABASE_URL, PORT: "0" }), /PORT/);
  assert.throws(() => loadEnvironment({ DATABASE_URL, NODE_ENV: "staging" }), /NODE_ENV/);
  assert.throws(() => loadEnvironment({ DATABASE_URL, FRONTEND_ORIGIN: "ftp://localhost" }), /FRONTEND_ORIGIN/);
});
