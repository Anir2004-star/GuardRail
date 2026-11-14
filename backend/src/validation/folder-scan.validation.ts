import { z } from "zod";
import { InputValidationError } from "./auth.validation.js";
const safeText = (max: number) => z.string().min(1).max(max).refine((value) => Array.from(value).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const count = z.number().int().nonnegative().max(100000);
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const date = z.string().datetime({ offset: true });
const type = z.string().regex(/^(\.[a-z0-9][a-z0-9+_-]{0,19}|No extension|Other)$/);
const relative = safeText(1024).refine((value) => !value.includes("\\") && !value.includes(":") && value.split("/").every((part) => !!part && part !== "." && part !== ".."));
export const folderScanSchema = z.strictObject({
  scanId: z.string().uuid(), folderName: safeText(80).refine((value) => value.trim().length > 0 && !/[\\/:]/.test(value) && value !== "." && value !== ".."),
  startedAt: date, finishedAt: date, fileCount: count, totalBytes: bytes, skippedCount: z.number().int().nonnegative().max(200000), limitReached: z.boolean(),
  types: z.array(z.strictObject({ type, count: count.positive(), bytes })).max(20),
  largestFiles: z.array(z.strictObject({ relativePath: relative, type, bytes, modifiedAt: date })).max(20),
}).refine((value) => {
  const typeCount = value.types.reduce((sum, group) => sum + group.count, 0);
  const typeBytes = value.types.reduce((sum, group) => sum + group.bytes, 0);
  return typeCount === value.fileCount && typeBytes === value.totalBytes && Number.isSafeInteger(typeBytes) &&
    new Set(value.types.map((group) => group.type)).size === value.types.length &&
    value.largestFiles.length === Math.min(value.fileCount, 20) &&
    new Set(value.largestFiles.map((file) => file.relativePath.toLowerCase())).size === value.largestFiles.length &&
    value.largestFiles.every((file, index) => file.bytes <= value.totalBytes && (index === 0 || file.bytes <= value.largestFiles[index - 1]!.bytes)) &&
    value.largestFiles.reduce((sum, file) => sum + file.bytes, 0) <= value.totalBytes &&
    Date.parse(value.startedAt) <= Date.parse(value.finishedAt) && Date.parse(value.finishedAt) - Date.parse(value.startedAt) <= 11 * 60000;
});
export function parseFolderScan(input: unknown) {
  const parsed = folderScanSchema.safeParse(input);
  if (!parsed.success || Math.abs(Date.now() - Date.parse(parsed.data.finishedAt)) > 5 * 60000) throw new InputValidationError({ body: ["Send a recent, bounded folder scan with valid summary totals and relative file metadata."] });
  return parsed.data;
}
