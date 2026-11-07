import { OAuth2Client } from "google-auth-library";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";

export class GoogleAuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export function invalidGoogle(): GoogleAuthError { return new GoogleAuthError(401, "INVALID_GOOGLE_CREDENTIAL", "Google sign-in could not be verified. Start again."); }
export function googleClientId(): string {
  const value = process.env.GOOGLE_CLIENT_ID;
  if (!value) throw new GoogleAuthError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is not configured. Use email and password.");
  if (!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)) {
    throw new GoogleAuthError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is unavailable. Use email and password.");
  }
  if (env.NODE_ENV === "production" && !env.FRONTEND_ORIGIN.startsWith("https://")) {
    throw new GoogleAuthError(503, "GOOGLE_UNAVAILABLE", "Google sign-in requires HTTPS.");
  }
  return value;
}
export function googleHash(value: string): string { return createHash("sha256").update(`guardrail:google:${value}`).digest("hex"); }
const client = new OAuth2Client({ transporterOptions: { timeout: 5000, retry: false } });
export async function verifyGoogleIdentity(credential: string, nonceHash: string) {
  const audience = googleClientId();
  try {
    // Never log library errors: they may embed the entire credential/payload.
    const header = JSON.parse(Buffer.from(credential.split(".")[0] ?? "", "base64url").toString("utf8"));
    if (header.alg !== "RS256") throw invalidGoogle();
    const ticket = await client.verifyIdToken({ idToken: credential, audience });
    const payload = ticket.getPayload();
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.sub !== "string" || !/^[\x21-\x7e]{1,255}$/.test(payload.sub) ||
      payload.email_verified !== true || typeof payload.email !== "string" || !z.email().safeParse(payload.email).success ||
      !Number.isInteger(payload.exp) || payload.exp <= now || !Number.isInteger(payload.iat) || payload.iat > now + 30 ||
      payload.exp - payload.iat > 7200 || payload.aud !== audience ||
      (payload.azp !== undefined && payload.azp !== audience) ||
      typeof payload.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce) || googleHash(payload.nonce) !== nonceHash) throw invalidGoogle();
    return {
      subject: payload.sub, email: payload.email.trim().toLowerCase(),
      name: typeof payload.name === "string" ? payload.name.trim().slice(0, 180) || null : null,
      firstName: typeof payload.given_name === "string" ? payload.given_name.trim().slice(0, 60) || null : null,
      lastName: typeof payload.family_name === "string" ? payload.family_name.trim().slice(0, 60) || null : null,
      authoritativeEmail: payload.email.toLowerCase().endsWith("@gmail.com") || (typeof payload.hd === "string" && payload.hd.length > 0),
    };
  } catch { throw invalidGoogle(); }
}
