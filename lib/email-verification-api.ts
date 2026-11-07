export const VERIFICATION_REQUEST_MESSAGE = "If an account needs verification, a verification link will be sent.";
export type VerificationResult = { ok: true } | { ok: false; message: string; invalidToken?: boolean };

async function request(route: "resend-verification" | "verify-email", body: { email: string } | { token: string }): Promise<VerificationResult> {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const confirming = route === "verify-email";
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit",
      cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(15000), body: JSON.stringify(body),
    });
    if (confirming && response.status === 204) return { ok: true };
    const result: unknown = await response.json().catch(() => undefined);
    if (!confirming && response.status === 202 && result && typeof result === "object" && "message" in result && result.message === VERIFICATION_REQUEST_MESSAGE) return { ok: true };
    if (confirming && response.status === 400) return { ok: false, invalidToken: true, message: "Verification link is invalid or expired. Request a new link." };
    if (response.status === 400) return { ok: false, message: "Enter a valid email address." };
    if (response.status === 429) return { ok: false, message: "Too many email verification attempts. Please try again later." };
    if (response.status === 403) return { ok: false, message: "Email verification is unavailable from this website address." };
    return { ok: false, message: "Email verification is temporarily unavailable. Please try again later." };
  } catch {
    return { ok: false, message: confirming ? "Could not confirm email verification. Try signing in, or request a new link." : "Could not reach email verification. Check your connection and try again." };
  }
}
export function resendVerificationEmail(email: string) { return request("resend-verification", { email: email.trim().toLowerCase() }); }
export function verifyEmailToken(token: string) { return request("verify-email", { token }); }
