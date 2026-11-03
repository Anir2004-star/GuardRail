import { loginResponseSchema, type LoginSession } from "./login-api";

export type RefreshFailure = "invalid" | "connection" | "blocked" | "limited" | "unexpected";
export type RefreshResult = { ok: true; session: LoginSession } | { ok: false; reason: RefreshFailure };

export async function refreshAccount(): Promise<RefreshResult> {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const startedAt = Date.now();
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: "POST", credentials: "include", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) return { ok: false, reason: "invalid" };
    if (response.status === 403) return { ok: false, reason: "blocked" };
    if (response.status === 429) return { ok: false, reason: "limited" };
    if (response.status !== 200) return { ok: false, reason: "unexpected" };
    const result = loginResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!result.success) return { ok: false, reason: "unexpected" };
    const session = { ...result.data, expiresAt: startedAt + result.data.expiresIn * 1000 };
    return session.expiresAt > Date.now() ? { ok: true, session } : { ok: false, reason: "unexpected" };
  } catch {
    return { ok: false, reason: "connection" };
  }
}
