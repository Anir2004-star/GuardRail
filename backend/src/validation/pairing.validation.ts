import { z } from "zod";
import { InputValidationError } from "./auth.validation.js";

const label = (max: number) => z.string().trim().min(1).max(max).refine((value) => Array.from(value).every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127));
export const claimSchema = z.strictObject({
  code: z.string().transform((value) => value.toUpperCase().replaceAll("-", "").trim()).pipe(z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/)),
  appName: label(80), platform: label(80), appVersion: label(40).optional(),
});
export const approvalSchema = z.strictObject({ claimId: z.string().uuid() });
export const emptyPairingSchema = z.strictObject({});
export function parsePairing<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new InputValidationError({ body: ["Send valid supported pairing fields."] });
  return parsed.data;
}
