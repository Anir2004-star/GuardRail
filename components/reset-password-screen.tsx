"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ShieldCheck } from "lucide-react";
import { validateAccountPassword } from "@/lib/password-validation";
import { resetPasswordAndClearSession } from "@/lib/session-coordinator";

export function ResetPasswordScreen() {
  const readLink = useRef(false);
  const [token, setToken] = useState<string | null>();
  const [complete, setComplete] = useState(false);
  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm<{ password: string; confirm: string }>({ defaultValues: { password: "", confirm: "" } });
  useEffect(() => {
    if (readLink.current) return;
    readLink.current = true;
    const values = new URLSearchParams(window.location.hash.slice(1)).getAll("token");
    const value = values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
    // Keep the reset secret only in this component's memory, never in browser
    // storage, the rendered DOM, subsequent URLs, or request/referrer logs.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    setToken(value);
  }, []);
  const submit = handleSubmit(async (data) => {
    if (!token || complete) return;
    if (data.password !== data.confirm) { setError("confirm", { message: "Passwords must match." }); return; }
    const result = await resetPasswordAndClearSession(token, data.password);
    if (!result.ok) {
      setError("root.server", { message: result.message });
      if (result.invalidToken) { setToken(null); reset(); }
      return;
    }
    reset(); setToken(null); setComplete(true);
  });
  return <main className="auth-page"><section className="auth-panel"><div className="auth-box">
    <Link className="brand" href="/">GUARDRAIL</Link>
    <span className="eyebrow">PASSWORD RECOVERY</span><h1>Choose a new password</h1>
    {complete ? <div className="feedback" role="status">Password changed. Sign in with your new password. <Link href="/login">Go to sign in</Link></div>
      : token === undefined ? <p role="status">Checking your reset link...</p>
        : !token ? <div className="feedback" role="alert">Reset link is invalid or expired. <Link href="/forgot-password">Request a new link</Link>.</div>
          : <form onSubmit={submit} noValidate>
            <label>New password<input type="password" autoComplete="new-password" {...register("password", { required: "Enter a password.", validate: validateAccountPassword })} aria-invalid={!!errors.password} aria-describedby="reset-password-help" /></label>
            <small id="reset-password-help">Use at least 15 characters with uppercase, lowercase, a number and a special character. Maximum 72 UTF-8 bytes.</small>
            {errors.password && <span className="field-error" role="alert">{errors.password.message}</span>}
            <label>Confirm new password<input type="password" autoComplete="new-password" {...register("confirm", { required: "Confirm your password." })} aria-invalid={!!errors.confirm} /></label>
            {errors.confirm && <span className="field-error" role="alert">{errors.confirm.message}</span>}
            <button className="button auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? "Please wait..." : "Change password"}</button>
            {errors.root?.server && <div className="field-error" role="alert">{errors.root.server.message}</div>}
          </form>}
    <p><Link href="/login">Back to sign in</Link></p>
  </div></section><aside className="auth-art"><div><ShieldCheck /><h2>A fresh start<br />for your account.</h2><p>Your reset link works once. Choose a password you can keep private.</p></div></aside></main>;
}
