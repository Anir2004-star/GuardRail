"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthSession } from "./auth-store";
import { getCurrentUser } from "@/lib/authenticated-api";
import { enterDemoSession, leaveClientSession } from "@/lib/session-coordinator";
import { SessionNotice } from "./session-manager";

export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useAuthSession((state) => state.session);
  const status = useAuthSession((state) => state.status);
  const token = session?.accessToken;
  const [attempt, setAttempt] = useState(0);
  const [verification, setVerification] = useState<{ token: string; pathname: string; error?: string } | null>(null);

  useEffect(() => {
    if (["anonymous", "logging-out", "logout-failed", "signed-out"].includes(status)) router.replace("/login");
    if (status === "demo" || status === "restoring" || !token) return;
    let active = true;
    void getCurrentUser().then((result) => {
      if (!active) return;
      if (result.ok) {
        const current = useAuthSession.getState().session;
        if (!current || current.accessToken !== result.token || current.user.id !== result.data.user.id) {
          setVerification({ token, pathname, error: "Your session changed. Please sign in again." });
          return;
        }
        if (JSON.stringify(current.user) !== JSON.stringify(result.data.user)) {
          useAuthSession.setState({ session: { ...current, user: result.data.user } });
        }
        setVerification({ token: result.token, pathname });
      } else if (result.kind !== "cancelled" && result.kind !== "unauthorized") {
        setVerification({ token, pathname, error: result.message });
      }
    });
    return () => { active = false; };
  }, [pathname, router, status, token, attempt]);

  if (status === "demo") return children;
  const checked = verification?.token === token && verification?.pathname === pathname;
  if (session && session.expiresAt > Date.now() && checked && !verification?.error) return children;
  const error = checked ? verification?.error : status === "paused" && !session ? "Could not restore your session. Please sign in again." : undefined;
  return <main className="workspace-page auth-gate" aria-busy={!error}>
    <h1>{error ? "Unable to verify your account" : "Checking your session"}</h1>
    {error ? <><p role="alert">{error}</p>{session && <button className="button" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry account check</button>}</> : <p role="status">Please wait while we check your sign-in.</p>}
    <SessionNotice />
    <p><Link href="/login" onClick={leaveClientSession}>Back to sign in</Link></p>
    <p><Link href={pathname} onClick={enterDemoSession}>Explore sample workspace</Link></p>
  </main>;
}
