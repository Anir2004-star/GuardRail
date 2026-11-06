"use client";

import { z } from "zod";
import { useAuthSession } from "@/components/auth-store";
import { rejectAccessSession, restoreOrRenewSession } from "./session-coordinator";
import { userSchema } from "./login-api";

type Failure = { ok: false; kind: "unauthorized" | "unavailable" | "forbidden" | "cancelled"; message: string };
type Result<T> = { ok: true; data: T; token: string } | Failure;
type RawResult = { status: number; body: unknown };
const requests = new Map<string, Promise<RawResult>>();

function send(path: string, token: string): Promise<RawResult> {
  const key = `${path}:${token}`;
  const pending = requests.get(key);
  if (pending) return pending;
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const request = fetch(`${apiUrl}${path}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
    credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => undefined) }))
    .finally(() => { requests.delete(key); });
  requests.set(key, request);
  return request;
}

export async function authenticatedGet<T>(path: string, schema: z.ZodType<T>): Promise<Result<T>> {
  // Restrict bearer credentials to fixed API paths on the configured backend.
  // No caller-controlled host, redirects, headers or token query parameters.
  if (!/^\/api\/v1\/[A-Za-z0-9/_-]+$/.test(path)) throw new Error("Use a fixed API path");
  let current = useAuthSession.getState();
  if (current.status === "demo") return { ok: false, kind: "unauthorized", message: "Sign in to access your account." };
  if (!current.session || current.session.expiresAt <= Date.now() + 30_000) await restoreOrRenewSession();
  current = useAuthSession.getState();
  let session = current.session;
  if (!session || session.expiresAt <= Date.now()) return {
    ok: false, kind: current.status === "paused" ? "unavailable" : "unauthorized",
    message: current.status === "paused" ? "Could not restore your session. Please sign in again." : "Please sign in again.",
  };
  try {
    let result = await send(path, session.accessToken);
    if (useAuthSession.getState().session?.accessToken !== session.accessToken) return { ok: false, kind: "cancelled", message: "Session changed." };
    if (result.status === 401) {
      const rejected = session.accessToken;
      await restoreOrRenewSession(rejected);
      current = useAuthSession.getState();
      session = current.session;
      if (current.status === "paused") return { ok: false, kind: "unavailable", message: "Could not renew your session. Please sign in again." };
      if (!session || session.accessToken === rejected || session.expiresAt <= Date.now()) {
        rejectAccessSession(rejected);
        return { ok: false, kind: "unauthorized", message: "Please sign in again." };
      }
      // Only one retry of this read, using the coordinator's replacement token.
      result = await send(path, session.accessToken);
      if (useAuthSession.getState().session?.accessToken !== session.accessToken) return { ok: false, kind: "cancelled", message: "Session changed." };
    }
    if (result.status === 401) {
      rejectAccessSession(session.accessToken);
      return { ok: false, kind: "unauthorized", message: "Please sign in again." };
    }
    if (result.status === 403) return { ok: false, kind: "forbidden", message: "You do not have access to this page." };
    if (result.status !== 200) return { ok: false, kind: "unavailable", message: "The account service is unavailable. Please try again." };
    const parsed = schema.safeParse(result.body);
    return parsed.success ? { ok: true, data: parsed.data, token: session.accessToken }
      : { ok: false, kind: "unavailable", message: "The account service returned an unexpected response. Please try again." };
  } catch {
    return { ok: false, kind: "unavailable", message: "Could not reach the account service. Check your connection and try again." };
  }
}

export function getCurrentUser() {
  return authenticatedGet("/api/v1/auth/me", z.object({ user: userSchema }));
}
