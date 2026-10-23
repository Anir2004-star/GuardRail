import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { env } from "../dist/config/env.js";

// This script NEVER runs test inserts on DATABASE_URL. It creates a new,
// randomly named local database and drops only that database after verification.
const adminUrl = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(adminUrl.hostname)) {
  throw new Error("Schema verification requires a local PostgreSQL server with database-creation permission.");
}
const databaseName = `guardrail_step4_test_${randomBytes(8).toString("hex")}`;
assert.match(databaseName, /^guardrail_step4_test_[a-f0-9]{16}$/);
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
testUrl.search = "";
assert.notEqual(testUrl.pathname, adminUrl.pathname);
const options = { connectionTimeoutMillis: 3_000, query_timeout: 10_000, statement_timeout: 10_000 };
const admin = new pg.Client({ ...options, connectionString: adminUrl.toString() });
const database = new pg.Client({ ...options, connectionString: testUrl.toString() });
let created = false;

async function migrationSql(suffix) {
  const root = new URL("../prisma/migrations/", import.meta.url);
  const matches = (await readdir(root)).filter((entry) => entry.endsWith(suffix));
  assert.equal(matches.length, 1, "Expected one migration for this schema verification step");
  return readFile(new URL(`${matches[0]}/migration.sql`, root), "utf8");
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await database.connect();
  await database.query(await migrationSql("_init_user"));
  const legacyId = randomUUID();
  const legacyEmail = `legacy-${legacyId}@example.invalid`;
  await database.query('INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, $3, NOW())', [legacyId, legacyEmail, "Temporary legacy user"]);
  const before = (await database.query('SELECT * FROM users WHERE id = $1', [legacyId])).rows[0];
  await database.query(await migrationSql("_add_password_hash_and_refresh_sessions"));
  const after = (await database.query('SELECT * FROM users WHERE id = $1', [legacyId])).rows[0];
  assert.equal(after.password_hash, null);
  const { password_hash: _hash, ...preserved } = after;
  assert.deepEqual(preserved, before);
  console.log("PASS: migration preserves existing users and leaves legacy password hashes null.");

  const familyId = randomUUID();
  const rootId = randomUUID();
  const nextId = randomUUID();
  const expiresAt = new Date(Date.now() + 604_800_000);
  const tokenHash = randomBytes(32).toString("hex");
  const replacementHash = randomBytes(32).toString("hex");
  const insert = 'INSERT INTO refresh_sessions (id, user_id, token_hash, family_id, expires_at) VALUES ($1, $2, $3, $4, $5)';
  await database.query(insert, [rootId, legacyId, tokenHash, familyId, expiresAt]);
  await database.query(insert, [nextId, legacyId, replacementHash, familyId, expiresAt]);
  await database.query('UPDATE refresh_sessions SET revoked_at = NOW(), replaced_by_id = $1 WHERE id = $2', [nextId, rootId]);
  const sessions = (await database.query('SELECT * FROM refresh_sessions WHERE family_id = $1', [familyId])).rows;
  assert.equal(sessions.length, 2);
  const consumed = sessions.find((row) => row.id === rootId);
  const replacement = sessions.find((row) => row.id === nextId);
  assert.equal(consumed.replaced_by_id, nextId);
  assert.ok(consumed.revoked_at instanceof Date);
  assert.equal(replacement.revoked_at, null);
  assert.equal(consumed.expires_at.getTime(), replacement.expires_at.getTime());
  assert.equal(consumed.token_hash, tokenHash);
  assert.ok(consumed.created_at instanceof Date);
  console.log("PASS: hashed session tokens, fixed family expiry and retained rotation history are stored.");

  await assert.rejects(database.query(insert, [randomUUID(), legacyId, tokenHash, familyId, expiresAt]), { code: "23505" });
  await assert.rejects(database.query(insert, [randomUUID(), randomUUID(), randomBytes(32).toString("hex"), familyId, expiresAt]), { code: "23503" });
  await assert.rejects(database.query('UPDATE refresh_sessions SET replaced_by_id = $1 WHERE id = $2', [randomUUID(), rootId]), { code: "23503" });
  console.log("PASS: duplicate token hashes and invalid user/replacement references are rejected.");

  await database.query('DELETE FROM users WHERE id = $1', [legacyId]);
  assert.equal((await database.query('SELECT COUNT(*)::int AS total FROM refresh_sessions')).rows[0].total, 0);
  console.log("PASS: user deletion removes its sessions in the isolated test database.");
} catch {
  console.error("Authentication schema verification failed. No development records were used as test data.");
  process.exitCode = 1;
} finally {
  await database.end().catch(() => {});
  if (created) {
    try {
      await admin.query(`DROP DATABASE "${databaseName}"`);
      console.log("PASS: isolated temporary test database removed.");
    } catch {
      console.error(`Test database cleanup failed for ${databaseName}. Development database was not targeted.`);
      process.exitCode = 1;
    }
  }
  await admin.end().catch(() => {});
}
