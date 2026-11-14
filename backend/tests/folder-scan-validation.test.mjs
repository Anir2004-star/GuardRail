import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
const { parseFolderScan } = await import("../dist/validation/folder-scan.validation.js");
const valid = () => ({ scanId: randomUUID(), folderName: "Sample", startedAt: new Date(Date.now() - 1000).toISOString(), finishedAt: new Date().toISOString(), fileCount: 1, totalBytes: 100, skippedCount: 0, limitReached: false, types: [{ type: ".txt", count: 1, bytes: 100 }], largestFiles: [{ relativePath: "nested/sample.txt", type: ".txt", bytes: 100, modifiedAt: new Date().toISOString() }] });
test("folder scan metadata validates bounded totals, relative paths and times", () => { assert.equal(parseFolderScan(valid()).totalBytes, 100); });
test("folder reports reject traversal, absolute roots, false totals and unknown fields without echoing paths", () => {
  for (const change of [{ ownerId: "PRIVATE_OWNER" }, { folderName: "C:\\PRIVATE_PATH" }, { fileCount: 2 }, { totalBytes: 101 }, { totalBytes: Number.MAX_SAFE_INTEGER + 1 }, { finishedAt: "bad" }, { largestFiles: [{ ...valid().largestFiles[0], relativePath: "../PRIVATE_PATH" }] }, { largestFiles: [{ ...valid().largestFiles[0], relativePath: "C:/PRIVATE_PATH" }] }]) assert.throws(() => parseFolderScan({ ...valid(), ...change }), (error) => !JSON.stringify(error).includes("PRIVATE_") && error.fields.body.length > 0);
});
