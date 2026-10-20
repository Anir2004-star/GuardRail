import type { Server } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";

let server: Server;
let shuttingDown = false;

function handleStartupError(error: NodeJS.ErrnoException): void {
  if (error.code === "EADDRINUSE") {
    console.error(`Guardrail backend could not start: port ${env.PORT} is already in use.`);
  } else {
    console.error("Guardrail backend could not start.", error);
  }
  process.exitCode = 1;
}

function shutDown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Stopping Guardrail backend...`);

  const forceTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out after 10 seconds. Closing remaining connections.");
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close((error) => {
    clearTimeout(forceTimer);
    if (error) {
      console.error("Guardrail backend stopped with an error.", error);
      process.exit(1);
    }
    console.log("Guardrail backend stopped.");
    process.exit(0);
  });
}

server = app.listen(env.PORT, () => {
  console.log(`Guardrail backend listening at http://localhost:${env.PORT}`);
});

server.on("error", handleStartupError);
process.on("SIGINT", () => shutDown("SIGINT"));
process.on("SIGTERM", () => shutDown("SIGTERM"));
