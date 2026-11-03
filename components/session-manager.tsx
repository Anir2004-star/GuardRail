"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthSession } from "./auth-store";
import { initializeSessionCoordination, leaveClientSession, logoutClientSession, restoreOrRenewSession } from "@/lib/session-coordinator";

export function SessionManager() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useAuthSession((state) => state.session);
  const status = useAuthSession((state) => state.status);
  useEffect(() => {
    initializeSessionCoordination();
    const workspace = pathname === "/app" || pathname.startsWith("/app/");
    if (workspace && ["logging-out", "logout-failed", "signed-out"].includes(status)) router.replace("/login");
    const check = () => {
      const current = useAuthSession.getState();
      if (current.session && current.session.expiresAt <= Date.now() && current.status === "paused") {
        useAuthSession.setState({ session: null });
      }
      if ((workspace || current.session) && (current.status === "idle" || current.status === "ready")) void restoreOrRenewSession();
    };
    check();
    const deadline = session ? session.expiresAt - (status === "paused" ? 0 : 30_000) : undefined;
    const timer = deadline === undefined ? undefined : window.setTimeout(check, Math.max(0, deadline - Date.now()));
    const visible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname, router, session, status]);
  return null;
}

export function SessionNotice() {
  const pathname = usePathname();
  const message = useAuthSession((state) => state.message);
  const status = useAuthSession((state) => state.status);
  if (!message) return null;
  return <div className="feedback session-notice" role="alert">{message}{status === "logout-failed" ? <> <button type="button" onClick={() => { void logoutClientSession(); }}>Retry logout</button></> : pathname !== "/login" && status !== "logging-out" && <> <Link href="/login" onClick={leaveClientSession}>Sign in again</Link></>}</div>;
}
