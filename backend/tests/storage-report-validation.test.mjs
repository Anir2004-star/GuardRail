import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { parseStorageReport } from "../dist/validation/storage-report.validation.js";
const now = new Date("2026-11-10T12:00:00Z");
const input = () => ({ reportId: randomUUID(), collectedAt: now.toISOString(), volumes: [{ id: "C:\\", totalBytes: 512000, freeBytes: 120000 }] });
test("capacity reports preserve integer bytes, drive letters and collection time without coercion", () => {
  const value = input(); const parsed = parseStorageReport(value, now);
  assert.equal(parsed.collectedAt.getTime(), now.getTime()); assert.deepEqual(parsed.volumes, value.volumes);
  assert.equal(parsed.reportId, value.reportId);
});
test("capacity reports reject impossible counts, duplicate letters, paths, unsafe sums and extra fields safely", () => {
  for (const change of [{ volumes: [] }, { volumes: [{ id: "C:\\Users\\PRIVATE_USER", totalBytes: 1, freeBytes: 0 }] }, { volumes: [{ id: "C:\\", totalBytes: 1, freeBytes: 2 }] }, { volumes: [{ id: "C:\\", totalBytes: "100", freeBytes: 0 }] }, { volumes: [{ id: "C:\\", totalBytes: 1.5, freeBytes: 0 }] }, { volumes: [input().volumes[0], input().volumes[0]] }, { volumes: [{ id: "C:\\", totalBytes: Number.MAX_SAFE_INTEGER, freeBytes: 0 }, { id: "D:\\", totalBytes: 2, freeBytes: 0 }] }, { deviceId: "PRIVATE_DEVICE" }, { ownerId: "PRIVATE_OWNER" }, { reportId: "PRIVATE_BAD_ID" }]) {
    assert.throws(() => parseStorageReport({ ...input(), ...change }, now), (error) => error.fields.body.length > 0 && !JSON.stringify(error).includes("PRIVATE_"));
  }
});
test("capacity collection time must be within five minutes of the server clock", () => {
  for (const collectedAt of ["invalid", new Date(now.getTime() - 300001).toISOString(), new Date(now.getTime() + 300001).toISOString()]) assert.throws(() => parseStorageReport({ ...input(), collectedAt }, now));
});
