import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { InvalidPasswordResetTokenError } from "../errors/auth.errors.js";

export type PasswordResetSecret = Readonly<{ value: string; toJSON: () => undefined }>;
class Secret {
  #value = randomBytes(32).toString("base64url");
  get value() { return this.#value; }
  toJSON(): undefined { return undefined; }
}
export function generatePasswordResetToken(): PasswordResetSecret { return Object.freeze(new Secret()); }
export function hashPasswordResetToken(token: unknown): string {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, "base64url").toString("base64url") !== token) {
    throw new InvalidPasswordResetTokenError();
  }
  return createHash("sha256").update(`guardrail:password-reset:${token}`, "utf8").digest("hex");
}
