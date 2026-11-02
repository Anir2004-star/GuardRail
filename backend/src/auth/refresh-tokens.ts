import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { InvalidRefreshTokenError } from "../errors/auth.errors.js";

export type RefreshToken = Readonly<{
  value: string;
  toJSON: () => undefined;
}>;

// Deliberate server-only access through .value. Private fields do not appear in
// normal object inspection, and JSON serialization omits this entire value.
class RefreshTokenSecret {
  #value: string;

  constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  get value(): string { return this.#value; }
  toJSON(): undefined { return undefined; }
}

export function generateRefreshToken(): RefreshToken {
  return new RefreshTokenSecret(randomBytes(32).toString("base64url"));
}

export function hashRefreshToken(token: unknown): string {
  if (
    typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    Buffer.from(token, "base64url").toString("base64url") !== token
  ) {
    throw new InvalidRefreshTokenError();
  }
  // Random 256-bit tokens need a fast lookup hash, unlike human passwords.
  return createHash("sha256").update(token, "utf8").digest("hex");
}
