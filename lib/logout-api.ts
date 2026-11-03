export type LogoutResult = { ok: true } | { ok: false };

export async function logoutAccount(): Promise<LogoutResult> {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  try {
    const response = await fetch(`${apiUrl}/api/v1/auth/logout`, {
      method: "POST", credentials: "include", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    return response.status === 204 ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}
