import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import console from "node:console";
import process from "node:process";
import pg from "pg";
import { env } from "../dist/config/env.js";

const execute = promisify(execFile);
const originalUrl = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(originalUrl.hostname)) {
  throw new Error("Registration tests require a local PostgreSQL server with CREATE DATABASE permission.");
}
const databaseName = `guardrail_registration_test_${randomBytes(8).toString("hex")}`;
assert.match(databaseName, /^guardrail_registration_test_[a-f0-9]{16}$/);
const testUrl = new URL(originalUrl);
testUrl.pathname = `/${databaseName}`;
testUrl.search = "";
assert.notEqual(testUrl.pathname, originalUrl.pathname);
const admin = new pg.Client({ connectionString: originalUrl.toString(), connectionTimeoutMillis: 3_000, query_timeout: 10_000 });
let created = false;
const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const childEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: testUrl.toString(),
  GUARDRAIL_REGISTRATION_TEST_DATABASE: databaseName,
  GUARDRAIL_DEVELOPMENT_DATABASE: originalUrl.pathname.slice(1),
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await execute(process.execPath, [
    fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy",
  ], { cwd: backendDirectory, env: childEnvironment, timeout: 60_000 });
  console.log("PASS: committed migrations applied to a new isolated test database.");
  const result = await execute(process.execPath, [
    "--test", "--test-concurrency=1", "tests/integration/registration.test.mjs",
  ], { cwd: backendDirectory, env: childEnvironment, timeout: 120_000 });
  console.log(result.stdout.trim());
} catch (error) {
  // Test output uses sample data; never print subprocess arguments or database URLs.
  if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") {
    console.error(error.stdout.trim());
  }
  console.error("Registration integration tests failed. Check the local database, migrations and test output.");
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      // Only this runner's successfully created database is eligible for cleanup.
      await admin.query(`DROP DATABASE "${databaseName}"`);
      console.log("PASS: isolated registration test database removed.");
    } catch {
      console.error(`Cleanup failed for temporary test database ${databaseName}. No development database was targeted.`);
      process.exitCode = 1;
    }
  }
  await admin.end().catch(() => {});
}
