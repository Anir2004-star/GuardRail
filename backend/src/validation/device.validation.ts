import { z } from "zod";
import { InputValidationError } from "./auth.validation.js";

function text(max: number, label: string) {
  return z.string({ error: `Enter a valid ${label}.` }).trim().max(max, `Use no more than ${max} characters for ${label}.`)
    .refine((value) => Array.from(value).every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127), `${label} must not contain control characters.`);
}
const name = text(60, "device name").min(1, "Enter a device name.");
const optionalText = (label: string) => text(80, label).optional().transform((value) => value || null);
export const deviceRegistrationSchema = z.strictObject({
  requestId: z.string().uuid("Start a new device registration."),
  name, type: z.enum(["Laptop", "Smartphone", "Tablet"], { error: "Choose Laptop, Smartphone or Tablet." }),
  brand: optionalText("brand"), model: optionalText("model"), os: optionalText("operating system"),
});
const renameSchema = z.strictObject({ name });
function parse<T>(schema: z.ZodType<T>, input: unknown, allowed: string[]): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    const key = typeof field === "string" && allowed.includes(field) ? field : "body";
    (fields[key] ??= []).push(key === "body" ? "Send only the supported device fields." : issue.message);
  }
  throw new InputValidationError(fields);
}
export function parseDeviceRegistration(input: unknown) { return parse(deviceRegistrationSchema, input, ["requestId", "name", "type", "brand", "model", "os"]); }
export function parseDeviceRename(input: unknown) { return parse(renameSchema, input, ["name"]); }
const deviceDetailsSchema = z.strictObject({
  brand: text(80, "brand").min(1).optional(), model: text(80, "model").min(1).optional(), os: text(80, "operating system").min(1).optional(),
}).refine((value) => Object.keys(value).length > 0);
export function parseDetectedDeviceDetails(input: unknown) { return parse(deviceDetailsSchema, input, ["brand", "model", "os"]); }
export function parseDeviceId(input: unknown): string {
  const result = z.string().uuid().safeParse(input);
  if (!result.success) throw new InputValidationError({ id: ["Use a valid device identifier."] });
  return result.data;
}
export function requireEmptyDeviceQuery(query: unknown): void {
  if (!query || typeof query !== "object" || Object.keys(query).length) throw new InputValidationError({ body: ["Device requests do not accept query parameters."] });
}
