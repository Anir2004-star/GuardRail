"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { resendVerificationEmail, VERIFICATION_REQUEST_MESSAGE, verifyEmailToken } from "@/lib/email-verification-api";

export function ResendVerification({ email }: { email?: string }) {
  const [enteredEmail, setEnteredEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  return <form aria-label="Resend email verification" noValidate onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    const value = (email ?? enteredEmail).trim().toLowerCase();
    if (!z.string().email().safeParse(value).success) { setNotice({ error: true, text: "Enter a valid email address." }); return; }
    setPending(true); setNotice(undefined);
    void resendVerificationEmail(value).then((result) => {
      setPending(false);
      setNotice(result.ok ? { error: false, text: VERIFICATION_REQUEST_MESSAGE } : { error: true, text: result.message });
    });
  }}>
    {!email && <label>Email address<input type="email" autoComplete="email" placeholder="you@gmail.com" value={enteredEmail} onChange={(event) => setEnteredEmail(event.target.value)} disabled={pending} /></label>}
    <button type="submit" className="text-button" disabled={pending}>{pending ? "Sending..." : "Resend verification email"}</button>
    {notice && <p className={notice.error ? "field-error" : "feedback"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </form>;
}

export function EmailVerificationScreen() {
  const readLink = useRef(false);
  const submitted = useRef(false);
  const [token, setToken] = useState<string | null>();
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (readLink.current) return;
    readLink.current = true;
    const values = new URLSearchParams(window.location.hash.slice(1)).getAll("token");
    const value = values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    setToken(value);
  }, []);
  async function confirm() {
    if (!token || submitted.current) return;
    submitted.current = true; setPending(true); setError("");
    const result = await verifyEmailToken(token);
    submitted.current = false; setPending(false);
    if (result.ok) { setToken(null); setComplete(true); }
    else { setError(result.message); if (result.invalidToken) setToken(null); }
  }
  return <main className="auth-page"><section className="auth-panel"><div className="auth-box">
    <Link className="brand" href="/">GUARDRAIL</Link>
    <h1>Verify your email</h1>
    {complete ? <p className="feedback" role="status">Email verified. Sign in with your password to continue.</p>
      : token === undefined ? <p role="status">Checking your verification link...</p>
        : token ? <><p>Confirm this email only if you created the Guardrail account. This does not sign you in.</p><button type="button" className="button auth-submit" disabled={pending} onClick={() => void confirm()}>{pending ? "Verifying..." : "Verify email"}</button></>
          : <p className="field-error" role="alert">Verification link is invalid or expired. Request a new link.</p>}
    {error && token && <p className="field-error" role="alert">{error}</p>}
    {!complete && token !== undefined && <ResendVerification />}
    <p><Link href="/login">Go to sign in</Link></p>
  </div></section><aside className="auth-art"><div><h2>Confirm your inbox.<br />Keep your account yours.</h2><p>Your verification link expires and works once.</p></div></aside></main>;
}
