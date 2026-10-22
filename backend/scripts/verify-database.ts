import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { disconnectDatabase, prisma } from "../src/config/database.js";

// No HTTP endpoint and no broad deletes: cleanup targets only this random ID.
const id = randomUUID();
const email = `guardrail-milestone-check-${id}@example.invalid`;

try {
  const user = await prisma.user.create({
    data: { id, email, name: "Guardrail temporary milestone verification" },
  });
  const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.email, email);
  assert.equal(stored.name, user.name);
  assert.ok(stored.createdAt instanceof Date);
  assert.ok(stored.updatedAt instanceof Date);
  console.log("PASS: temporary User created and read back.");
} catch {
  console.error("Database persistence verification failed; check database availability and migrations.");
  process.exitCode = 1;
} finally {
  try {
    // Also clean up if insertion succeeded but its response was interrupted.
    await prisma.user.deleteMany({ where: { id, email } });
    assert.equal(await prisma.user.findUnique({ where: { id } }), null);
    console.log("PASS: exact temporary User deleted and cleanup confirmed.");
  } catch {
    console.error(`Cleanup failed for temporary User ID ${id}; remove only that record before retrying.`);
    process.exitCode = 1;
  } finally {
    try {
      await disconnectDatabase();
    } catch {
      console.error("Database client cleanup failed.");
      process.exitCode = 1;
    }
  }
}
