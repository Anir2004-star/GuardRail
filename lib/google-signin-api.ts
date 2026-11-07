import { z } from "zod";
import { loginResponseSchema, type LoginResult } from "./login-api";

export type GoogleIntent = "login" | "signup" | "link";
export type GoogleInput = { intent: GoogleIntent; credential: string; password?: string };
const apiUrl = () => (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
function failure(status: number, code?: string): string {
  if (code === "EMAIL_NOT_VERIFIED") return "Verify your email before linking or signing in. Check your inbox or use Resend verification email.";
  if (status === 503) return "Google sign-in is unavailable. Use email and password, or try again later.";
  if (status === 403) return "Google sign-in is unavailable from this website address.";
  if (status === 429) return "Too many Google sign-in attempts. Please try again later.";
  if (code === "GOOGLE_EMAIL_VERIFICATION_REQUIRED") return "Register with email and password first, then link your Google account.";
  if (status === 409) return "Sign up with Google first, or use Link existing account with Google and your existing password.";
  return "Google sign-in could not complete. Start again and check your account details.";
}
const options = { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", cache: "no-store", redirect: "error" } as const;
const challengeSchema = z.object({ clientId: z.string().regex(/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresIn: z.literal(300) });
export async function beginGoogleSignIn(intent: GoogleIntent) {
  try {
    const response = await fetch(`${apiUrl()}/api/v1/auth/google/challenge`, { ...options, signal: AbortSignal.timeout(10_000), body: JSON.stringify({ intent }) });
    const parsed = challengeSchema.safeParse(await response.json().catch(() => undefined));
    if (response.status === 200 && parsed.success) return { ok: true as const, challenge: parsed.data };
    return { ok: false as const, message: failure(response.status) };
  } catch { return { ok: false as const, message: "Could not reach Google sign-in. Check your connection and start again." }; }
}
export async function completeGoogleSignIn(input: GoogleInput): Promise<LoginResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${apiUrl()}/api/v1/auth/google/complete`, { ...options, signal: AbortSignal.timeout(15_000), body: JSON.stringify(input) });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.status === 200) {
      const parsed = loginResponseSchema.safeParse(body);
      if (parsed.success) return { ok: true, session: { ...parsed.data, expiresAt: startedAt + parsed.data.expiresIn * 1000 } };
    }
    const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
    return { ok: false, message: failure(response.status, error.success ? error.data.error.code : undefined) };
  } catch { return { ok: false, message: "Could not confirm Google sign-in. Start again; no request was retried automatically." }; }
}
