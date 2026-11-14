"use client";
import { z } from "zod";
import { authenticatedGet } from "./authenticated-api";
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(100000);
const type = z.string().regex(/^(\.[a-z0-9][a-z0-9+_-]{0,19}|No extension|Other)$/);
const date = z.string().datetime({ offset: true });
const text = (max: number) => z.string().min(1).max(max).refine((value) => Array.from(value).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
export const folderScanResultSchema = z.object({
  scanId: z.string().uuid(), folderName: text(80).refine((value) => !/[\\/:]/.test(value)), startedAt: date, finishedAt: date, receivedAt: date,
  fileCount: count, totalBytes: bytes, skippedCount: z.number().int().nonnegative().max(200000), limitReached: z.boolean(),
  types: z.array(z.object({ type, count: count.positive(), bytes })).max(20),
  largestFiles: z.array(z.object({ relativePath: text(1024).refine((value) => !/[\\:]/.test(value) && value.split("/").every((part) => !!part && part !== "." && part !== "..")), type, bytes, modifiedAt: date })).max(20),
}).refine((value) => value.types.reduce((sum, group) => sum + group.count, 0) === value.fileCount &&
  value.types.reduce((sum, group) => sum + group.bytes, 0) === value.totalBytes &&
  value.largestFiles.length === Math.min(value.fileCount, 20) &&
  new Set(value.types.map((group) => group.type)).size === value.types.length &&
  new Set(value.largestFiles.map((file) => file.relativePath.toLowerCase())).size === value.largestFiles.length &&
  value.largestFiles.reduce((sum, file) => sum + file.bytes, 0) <= value.totalBytes &&
  value.largestFiles.every((file, index) => file.bytes <= value.totalBytes && (index === 0 || file.bytes <= value.largestFiles[index - 1]!.bytes)));
export type FolderScanResult = z.infer<typeof folderScanResultSchema>;
export function getAccountFolderScan(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new Error("Use a valid device identifier");
  return authenticatedGet(`/api/v1/devices/${id}/folder-scan`, z.object({ scan: folderScanResultSchema.nullable() }), { deduplicate: false });
}
