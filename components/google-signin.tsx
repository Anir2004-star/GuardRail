"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { beginGoogleSignIn, type GoogleIntent } from "@/lib/google-signin-api";
import { signInGoogleAccount } from "@/lib/session-coordinator";

type GoogleSdk = { accounts: { id: {
  initialize: (options: { client_id: string; nonce: string; auto_select: boolean; callback: (response: { credential: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: { type: string; theme: string; size: string; text: string }) => void;
  cancel: () => void;
} } };
type Challenge = { clientId: string; nonce: string; expiresIn: 300 };

export function GoogleSignIn({ mode, disabled, onSuccess, onBusy }: {
  mode: "login" | "signup"; disabled: boolean;
  onSuccess: () => void; onBusy: (value: boolean) => void;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [intent, setIntent] = useState<GoogleIntent>(mode);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const active = useRef(0);
  const submitted = useRef(false);
  const mounted = useRef(false);
  const latest = useRef({ password, onSuccess, onBusy });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { latest.current = { password, onSuccess, onBusy }; });
  useEffect(() => {
    if (!challenge || !sdkReady || !host.current) return;
    const google = (window as Window & { google?: GoogleSdk }).google;
    if (!google) return;
    const generation = ++active.current;
    submitted.current = false;
    google.accounts.id.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, auto_select: false, callback: (response) => {
      if (active.current !== generation || submitted.current) return;
      submitted.current = true;
      setBusy(true); latest.current.onBusy(true);
      void signInGoogleAccount({ intent, credential: response.credential,
        ...(intent === "link" ? { password: latest.current.password } : {}),
      }).then((result) => {
        if (active.current !== generation) return;
        setPassword(""); setBusy(false); latest.current.onBusy(false); setChallenge(null);
        if (result.ok) latest.current.onSuccess();
        else setMessage(result.message);
      }).catch(() => {
        if (active.current !== generation) return;
        setPassword(""); setBusy(false); latest.current.onBusy(false); setChallenge(null);
        setMessage("Google sign-in could not load. Check your connection and start again.");
      });
    } });
    google.accounts.id.renderButton(host.current, { type: "standard", theme: "outline", size: "large", text: "continue_with" });
    const timer = window.setTimeout(() => { if (!submitted.current) { setChallenge(null); setMessage("Google sign-in expired. Start again."); } }, 300_000);
    return () => { ++active.current; window.clearTimeout(timer); google.accounts.id.cancel(); };
  }, [challenge, sdkReady, intent]);
  async function begin() {
    if (busy || disabled) return;
    setMessage("");
    if (intent === "link" && (!password || new TextEncoder().encode(password).length > 72)) { setMessage("Enter your existing account password (maximum 72 UTF-8 bytes)."); return; }
    setBusy(true); onBusy(true);
    const result = await beginGoogleSignIn(intent);
    if (!mounted.current) return;
    setBusy(false); onBusy(false);
    if (result.ok) setChallenge(result.challenge);
    else setMessage(result.message);
  }
  return <section className="google-auth" aria-label="Google sign-in">
    {intent === "link" && <label>Existing account password<input type="password" autoComplete="current-password" value={password} disabled={busy || !!challenge} onChange={(event) => setPassword(event.target.value)} /></label>}
    {!challenge && <button type="button" className="button auth-submit" disabled={disabled || busy} onClick={() => void begin()}>{busy ? "Please wait..." : intent === "link" ? "Verify and link Google account" : "Continue with Google"}</button>}
    {challenge && <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setSdkReady(true)} onError={() => { setChallenge(null); setMessage("Google sign-in could not load. Check your connection or use email and password."); }} />
      {!sdkReady && <p role="status">Loading Google sign-in...</p>}
      <div ref={host} inert={busy || disabled} />
      <button type="button" className="text-button" disabled={busy} onClick={() => { setChallenge(null); setPassword(""); setMessage("Google sign-in cancelled."); }}>Cancel Google sign-in</button>
    </>}
    {mode === "login" && !challenge && <button type="button" className="text-button" disabled={busy || disabled} onClick={() => { setPassword(""); setMessage(""); setIntent(intent === "link" ? "login" : "link"); }}>{intent === "link" ? "Back to Google sign-in" : "Link existing account with Google"}</button>}
    {mode === "signup" && <p className="muted-copy">Google signup creates your account and signs you in.</p>}
    {message && <p className="field-error" role="alert">{message}</p>}
  </section>;
}
