"use client";

import { z } from "zod";
import { useAuthSession } from "@/components/auth-store";
import { loginAccount, loginResponseSchema, type LoginInput, type LoginResult, type LoginSession } from "./login-api";
import { refreshAccount } from "./refresh-api";
import { logoutAccount, type LogoutResult } from "./logout-api";
import { resetAccountPassword, type PasswordRecoveryResult } from "./password-reset-api";

const key = "guardrail.auth.coordination.v1";
const lock = "guardrail.auth.cookie.v1";
const metadataSchema = z.object({
  revision: z.string().uuid(),
  state: z.enum(["active", "pending", "paused", "anonymous", "demo", "logging-out", "logout-failed", "signed-out"]),
  message: z.enum(["", "expired", "connection", "blocked", "limited", "unexpected", "interrupted", "unsupported"]),
});
type Metadata = z.infer<typeof metadataSchema>;
let channel: BroadcastChannel | undefined;
let revision: string | undefined;
let refreshInFlight: Promise<void> | undefined;
let logoutInFlight: Promise<LogoutResult> | undefined;
let initialized = false;
const sessionWaiters = new Map<string, () => void>();

async function requestSharedSession(operation: string): Promise<void> {
  if (!channel) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      sessionWaiters.delete(operation);
      resolve();
    };
    const timer = window.setTimeout(finish, 200);
    sessionWaiters.set(operation, finish);
    try { channel?.postMessage({ requestSession: operation }); } catch { finish(); }
  });
}

function read(): Metadata | null {
  const value = localStorage.getItem(key);
  if (!value) return null;
  const result = metadataSchema.safeParse(JSON.parse(value));
  if (!result.success) throw new Error("Invalid session coordination metadata");
  return result.data;
}
function write(record: Metadata): void {
  // Metadata only: NEVER tokens, passwords, cookies or user profiles.
  localStorage.setItem(key, JSON.stringify(record));
}
function notice(reason: Metadata["message"]): string {
  if (!reason) return "";
  if (reason === "expired") return "Your session has expired. Please sign in again.";
  if (reason === "blocked") return "Session renewal is unavailable from this website address. Please sign in again.";
  if (reason === "limited") return "Too many session refresh attempts. Please sign in again later.";
  if (reason === "unsupported") return "Automatic session renewal is unavailable in this browser. Please sign in again when needed.";
  return "Session renewal could not complete. Automatic retries are paused. Please sign in again.";
}
function apply(record: Metadata): void {
  if (record.state === "logging-out" || record.state === "logout-failed" || record.state === "signed-out") {
    revision = record.revision;
    useAuthSession.setState({
      session: null, status: record.state,
      message: record.state === "logging-out" ? "Signing out..." : record.state === "logout-failed"
        ? "Local sign-in was cleared, but server logout could not be confirmed. Retry logout." : "",
    });
  } else if (record.state === "anonymous" || record.state === "demo") {
    revision = record.revision;
    useAuthSession.setState({ session: null, status: record.state === "demo" ? "demo" : "anonymous", message: notice(record.message) });
  } else if (record.state === "paused") {
    const session = useAuthSession.getState().session;
    useAuthSession.setState({ session: session && session.expiresAt > Date.now() ? session : null, status: "paused", message: notice(record.message) });
  } else if (record.state === "active" && revision !== record.revision) {
    useAuthSession.setState({ session: null, status: "idle", message: "" });
  }
}
function share(session: LoginSession, operation: string): void {
  revision = operation;
  write({ revision: operation, state: "active", message: "" });
  useAuthSession.getState().setSession(session);
  channel?.postMessage({ revision: operation, session });
}

export function initializeSessionCoordination(): void {
  if (initialized) return;
  initialized = true;
  if (typeof BroadcastChannel !== "undefined") {
    try {
    channel = new BroadcastChannel(lock);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const control = z.object({ control: z.literal("logout"), record: metadataSchema }).safeParse(event.data);
        if (control.success && ["logging-out", "logout-failed", "signed-out"].includes(control.data.record.state)) {
          try {
            const current = read();
            if (!current || current.revision === control.data.record.revision) apply(control.data.record);
          } catch { apply(control.data.record); }
          return;
        }
        const peer = z.object({ requestSession: z.string().uuid() }).safeParse(event.data);
        if (peer.success) {
          const record = read();
          const session = useAuthSession.getState().session;
          if (record?.state === "active" && record.revision === peer.data.requestSession && revision === record.revision && session && session.expiresAt > Date.now() + 30_000) {
            channel?.postMessage({ revision: record.revision, session });
          }
          return;
        }
        const result = z.object({ revision: z.string().uuid(), session: loginResponseSchema.extend({ expiresAt: z.number().finite() }) }).safeParse(event.data);
        if (!result.success) return;
        const record = read();
        const { session } = result.data;
        if (record?.state !== "active" || record.revision !== result.data.revision || session.expiresAt <= Date.now() || session.expiresAt > Date.now() + session.expiresIn * 1000) return;
        revision = record.revision;
        useAuthSession.getState().setSession(session);
        sessionWaiters.get(record.revision)?.();
      } catch { /* No secrets in diagnostics; restoration can use the lock. */ }
    };
    } catch { channel = undefined; }
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    try {
      const record = read();
      if (record) apply(record);
      else useAuthSession.setState({ session: null, status: "idle", message: "" });
    } catch {
      useAuthSession.setState({ session: null, status: "paused", message: notice("unsupported") });
    }
  });
  // Public sign-in pages do not refresh, but must retain a failed logout's retry
  // notice after reload. An interrupted logout is safe to retry explicitly.
  try {
    let current = read();
    if (current?.state === "logging-out") {
      current = { ...current, state: "logout-failed" };
      write(current);
    }
    if (current && current.state !== "active" && current.state !== "pending") apply(current);
  } catch { /* Storage failures are handled before automatic renewal. */ }
}

function clearClientIdentity(state: "demo" | "anonymous"): void {
  initializeSessionCoordination();
  const record: Metadata = { revision: crypto.randomUUID(), state, message: "" };
  try { write(record); } catch { /* Local memory can still be cleared. */ }
  apply(record);
}

export function enterDemoSession(): void { clearClientIdentity("demo"); }
export function leaveClientSession(): void { clearClientIdentity("anonymous"); }

export async function resetPasswordAndClearSession(token: string, password: string): Promise<PasswordRecoveryResult> {
  const action = async () => {
    const result = await resetAccountPassword(token, password);
    if (result.ok) leaveClientSession();
    return result;
  };
  try {
    return await (navigator.locks ? navigator.locks.request(lock, { signal: AbortSignal.timeout(20_000) }, action) : action());
  } catch {
    return { ok: false, message: "Could not confirm the password change. Try signing in with the new password, or request a new reset link." };
  }
}

export function rejectAccessSession(token: string): void {
  if (useAuthSession.getState().session?.accessToken !== token) return;
  const record: Metadata = { revision: crypto.randomUUID(), state: "anonymous", message: "expired" };
  try { write(record); } catch { /* Always remove the rejected local token. */ }
  apply(record);
}

export async function signInAccount(input: LoginInput): Promise<LoginResult> {
  initializeSessionCoordination();
  let requestedRevision: string | undefined;
  try { requestedRevision = read()?.revision; } catch { /* Fresh sign-in can repair metadata. */ }
  const action = async (): Promise<LoginResult> => {
    try {
      const current = read();
      if (current && ["logging-out", "logout-failed", "signed-out"].includes(current.state) && current.revision !== requestedRevision) {
        return { ok: false, message: "Sign-in was cancelled by logout. Please try again." };
      }
    } catch { /* Fresh sign-in can repair metadata. */ }
    const operation = crypto.randomUUID();
    let persistent = true;
    try { write({ revision: operation, state: "pending", message: "" }); } catch { persistent = false; }
    useAuthSession.setState({ session: null, status: "restoring", message: "" });
    const result = await loginAccount(input);
    try {
      if (persistent && read()?.revision !== operation) return { ok: false, message: "Sign-in was cancelled. Please try again." };
    } catch { persistent = false; }
    if (result.ok) {
      try {
        if (persistent) share(result.session, operation);
        else throw new Error("Coordination unavailable");
      } catch {
        useAuthSession.setState({ session: result.session, status: "paused", message: notice("unsupported") });
      }
    } else {
      const record: Metadata = { revision: operation, state: "anonymous", message: "" };
      try { if (persistent) write(record); } catch { /* Still clear local identity. */ }
      apply(record);
    }
    return result;
  };
  try {
    return await (navigator.locks ? navigator.locks.request(lock, { signal: AbortSignal.timeout(20_000) }, action) : action());
  } catch {
    return { ok: false, message: "Sign-in could not complete. Please try again." };
  }
}

export function restoreOrRenewSession(rejectedToken?: string): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  initializeSessionCoordination();
  refreshInFlight = (async () => {
    if (!navigator.locks) {
      useAuthSession.setState({ status: "paused", message: notice("unsupported") });
      return;
    }
    await navigator.locks.request(lock, { signal: AbortSignal.timeout(20_000) }, async () => {
      let record = read();
      let session = useAuthSession.getState().session;
      if (record?.state === "active" && (!session || revision !== record.revision)) {
        // A storage event may arrive before the session broadcast. Ask a live
        // peer for the current revision before consuming another refresh token.
        await requestSharedSession(record.revision);
        record = read();
        session = useAuthSession.getState().session;
      }
      if (record?.state === "logging-out") {
        record = { ...record, state: "logout-failed" };
        write(record);
        apply(record);
        return;
      }
      if (record?.state === "logout-failed" || record?.state === "signed-out") { apply(record); return; }
      if (session && session.expiresAt > Date.now() + 30_000 && record?.state === "active" && session.accessToken !== rejectedToken) return;
      if (record?.state === "anonymous" || record?.state === "demo" || record?.state === "paused") { apply(record); return; }
      if (record?.state === "pending") {
        // The lock is free but a previous operation never recorded its outcome.
        // Its token may have been consumed. Never retry automatically.
        record = { ...record, state: "paused", message: "interrupted" };
        write(record);
        apply(record);
        return;
      }
      const hadSession = Boolean(session || record?.state === "active");
      const operation = crypto.randomUUID();
      write({ revision: operation, state: "pending", message: "" });
      useAuthSession.setState({ status: "restoring", message: "" });
      const result = await refreshAccount();
      if (read()?.revision !== operation) return; // Explicit demo/leave won the race.
      if (result.ok) share(result.session, operation);
      else {
        const failure: Metadata = {
          revision: operation, state: result.reason === "invalid" ? "anonymous" : "paused",
          message: result.reason === "invalid" ? hadSession ? "expired" : "" : result.reason,
        };
        write(failure);
        apply(failure);
      }
    });
  })().catch(() => {
    // Storage/locking errors also fail closed, without another network attempt.
    useAuthSession.setState({ status: "paused", message: notice("unsupported") });
  }).finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}

export function logoutClientSession(): Promise<LogoutResult> {
  if (logoutInFlight) return logoutInFlight;
  initializeSessionCoordination();
  const operation = crypto.randomUUID();
  const publish = (state: "logging-out" | "logout-failed" | "signed-out") => {
    const record: Metadata = { revision: operation, state, message: "" };
    try { write(record); } catch { /* Local identity must still be cleared. */ }
    apply(record);
    channel?.postMessage({ control: "logout", record });
  };
  // Invalidate in-flight login/refresh results immediately, then wait for their
  // cookie updates before sending logout under the shared lock.
  publish("logging-out");
  const action = async (): Promise<LogoutResult> => {
    let current: Metadata | null = null;
    try { current = read(); } catch { /* Logout can still revoke the cookie. */ }
    if (current && current.revision !== operation) return { ok: false };
    const result = await logoutAccount();
    try { current = read(); } catch { current = null; }
    if (!current || current.revision === operation) publish(result.ok ? "signed-out" : "logout-failed");
    return result;
  };
  logoutInFlight = (async () => {
    try {
      return await (navigator.locks ? navigator.locks.request(lock, { signal: AbortSignal.timeout(20_000) }, action) : action());
    } catch {
      try { if (read()?.revision !== operation) return { ok: false } as const; } catch { /* Still report failure. */ }
      publish("logout-failed");
      return { ok: false } as const;
    }
  })().finally(() => { logoutInFlight = undefined; });
  return logoutInFlight;
}
