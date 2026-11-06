export const RESET_REQUEST_MESSAGE = "If an account exists for that email, a password reset link will be sent.";
export type PasswordRecoveryResult = { ok: true } | { ok: false; message: string; invalidToken?: boolean };

async function recoveryRequest(route: "forgot-password" | "reset-password", input: { email: string } | { token: string; password: string }): Promise<PasswordRecoveryResult> {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const reset = route === "reset-password";
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: reset ? "include" : "omit", referrerPolicy: "no-referrer",
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000), body: JSON.stringify(input),
    });
    if (reset && response.status === 204) return { ok: true };
    const body: unknown = await response.json().catch(() => undefined);
    if (!reset && response.status === 202 && body && typeof body === "object" && "message" in body && body.message === RESET_REQUEST_MESSAGE) return { ok: true };
    if (response.status === 400) {
      const invalid = reset && body !== null && typeof body === "object" && "error" in body && body.error !== null && typeof body.error === "object" && "code" in body.error && body.error.code === "INVALID_RESET_TOKEN";
      return invalid ? { ok: false, invalidToken: true, message: "Reset link is invalid or expired. Request a new link." }
        : { ok: false, message: reset ? "Check your new password and try again." : "Enter a valid email address." };
    }
    if (response.status === 429) return { ok: false, message: "Too many password recovery attempts. Please try again later." };
    if (response.status === 403) return { ok: false, message: "Password recovery is unavailable from this website address." };
    return { ok: false, message: "Password recovery is temporarily unavailable. Please try again later." };
  } catch {
    return { ok: false, message: reset
      ? "Could not confirm the password change. Try signing in with the new password, or request a new reset link."
      : "Could not reach the password recovery service. Check your connection and try again." };
  }
}
export function requestPasswordReset(email: string) { return recoveryRequest("forgot-password", { email: email.trim().toLowerCase() }); }
export function resetAccountPassword(token: string, password: string) { return recoveryRequest("reset-password", { token, password }); }
