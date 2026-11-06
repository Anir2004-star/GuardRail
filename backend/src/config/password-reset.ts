import { isIP } from "node:net";
import { z } from "zod";
import { env } from "./env.js";

function integer(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  const text = value ?? String(fallback);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min || Number(text) > max) {
    throw new Error(`Invalid password reset configuration: ${name} is out of range.`);
  }
  return Number(text);
}
function boolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`Invalid password reset configuration: ${name} must be true or false.`);
}

export function loadPasswordResetEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const production = source.NODE_ENV === "production";
  const host = source.SMTP_HOST ?? (production ? undefined : "127.0.0.1");
  if (host !== undefined && (!host || host.length > 253 || (!isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)))) {
    throw new Error("Invalid password reset configuration: SMTP_HOST must be a host name or IP address.");
  }
  const secure = boolean(source.SMTP_SECURE, "SMTP_SECURE");
  const local = ["localhost", "127.0.0.1", "::1"].includes(host ?? "");
  const user = source.SMTP_USER || undefined;
  const password = source.SMTP_PASSWORD || undefined;
  if (Boolean(user) !== Boolean(password) || (user && /[\r\n\0]/.test(user))) {
    throw new Error("Invalid password reset configuration: configure SMTP_USER and SMTP_PASSWORD together.");
  }
  const from = source.MAIL_FROM ?? (production ? undefined : "guardrail@example.invalid");
  if (from !== undefined && !z.email().safeParse(from).success) {
    throw new Error("Invalid password reset configuration: MAIL_FROM must be an email address.");
  }
  return Object.freeze({
    ttlSeconds: integer(source.PASSWORD_RESET_TTL_SECONDS, 1800, 300, 3600, "PASSWORD_RESET_TTL_SECONDS"),
    host, secure, user, password, from,
    port: integer(source.SMTP_PORT, secure ? 465 : local && !production ? 1025 : 587, 1, 65535, "SMTP_PORT"),
    // Plain SMTP is permitted only for a local development/test inbox.
    requireTLS: !secure && (production || !local),
  });
}

export const passwordResetEnv = loadPasswordResetEnvironment({ ...process.env, NODE_ENV: env.NODE_ENV });
