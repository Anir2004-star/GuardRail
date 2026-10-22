import assert from "node:assert/strict";
import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import { app } from "../dist/app.js";
import { disconnectDatabase } from "../dist/config/database.js";

// Interactive so the operator controls Docker; this never stops a shared DB.
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

async function verify(expectedStatus, expectedBody) {
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8_000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", message: "Guardrail backend is running" });
  const ready = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(8_000) });
  assert.equal(ready.status, expectedStatus);
  assert.deepEqual(await ready.json(), expectedBody);
  console.log(`PASS: /health 200; /ready ${expectedStatus}.`);
}

try {
  await verify(200, { status: "ready", database: "connected" });
  if (process.argv.includes("--outage")) {
    await terminal.question("Stop only the dedicated local Guardrail PostgreSQL service in another terminal, then press Enter. ");
    await verify(503, { status: "not_ready", database: "unavailable" });
    await terminal.question("Restart that service and wait until healthy, then press Enter. ");
    await verify(200, { status: "ready", database: "connected" });
  }
} catch {
  console.error("Readiness verification failed. Check database status and environment configuration.");
  process.exitCode = 1;
} finally {
  terminal.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
}
