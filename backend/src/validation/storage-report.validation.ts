import { z } from "zod";
import { InputValidationError } from "./auth.validation.js";

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const storageVolumesSchema = z.array(z.strictObject({
  id: z.string().regex(/^[A-Z]:\\$/), totalBytes: bytes.positive(), freeBytes: bytes,
}).refine((volume) => volume.freeBytes <= volume.totalBytes)).min(1).max(26)
  .refine((volumes) => new Set(volumes.map((volume) => volume.id)).size === volumes.length)
  .refine((volumes) => Number.isSafeInteger(volumes.reduce((sum, volume) => sum + volume.totalBytes, 0)));
export const storageReportSchema = z.strictObject({
  reportId: z.string().uuid(), collectedAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  volumes: storageVolumesSchema,
});
export function parseStorageReport(input: unknown, now = new Date()) {
  const parsed = storageReportSchema.safeParse(input);
  if (!parsed.success || Math.abs(parsed.data.collectedAt.getTime() - now.getTime()) > 5 * 60 * 1000) {
    throw new InputValidationError({ body: ["Send a current capacity report with a unique report ID and 1–26 distinct fixed-drive letters and valid byte counts. Check the device clock."] });
  }
  return parsed.data;
}
