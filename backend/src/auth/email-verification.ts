import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { InputValidationError, emailSchema } from "../validation/auth.validation.js";

export class EmailVerificationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export function assertEmailAccess(user: { emailVerifiedAt: Date | null; emailVerificationExempt: boolean }): void {
  if (!user.emailVerifiedAt && !user.emailVerificationExempt) {
    throw new EmailVerificationError(403, "EMAIL_NOT_VERIFIED", "Verify your email before signing in.");
  }
}
export function invalidVerification(): EmailVerificationError {
  return new EmailVerificationError(400, "INVALID_VERIFICATION_TOKEN", "Verification link is invalid or expired. Request a new link.");
}
export function verificationUnavailable(): EmailVerificationError {
  return new EmailVerificationError(503, "VERIFICATION_UNAVAILABLE", "Email verification is temporarily unavailable. Please try again later.");
}
export function verificationTtl(source: NodeJS.ProcessEnv = process.env): number {
  const text = source.EMAIL_VERIFICATION_TTL_SECONDS ?? "3600";
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 300 || value > 86400) throw new Error("Invalid EMAIL_VERIFICATION_TTL_SECONDS: use 300 to 86400 seconds.");
  return value;
}
class VerificationSecret {
  #value = randomBytes(32).toString("base64url");
  get value() { return this.#value; }
  toJSON(): undefined { return undefined; }
}
export function generateVerificationToken() { return Object.freeze(new VerificationSecret()); }
export function hashVerificationToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) throw invalidVerification();
  return createHash("sha256").update(`guardrail:email-verification:${value}`).digest("hex");
}
const resendSchema = z.strictObject({ email: emailSchema });
const confirmSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export function parseVerificationEmail(input: unknown): string {
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError({ email: ["Enter a valid email address and send only email."] });
  return parsed.data.email;
}
export function parseVerificationToken(input: unknown): string {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) throw invalidVerification();
  return hashVerificationToken(parsed.data.token);
}
