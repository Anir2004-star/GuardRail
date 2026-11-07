"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { registerAccount } from "@/lib/registration-api";
import { enterDemoSession, signInAccount } from "@/lib/session-coordinator";
import { SessionNotice } from "./session-manager";
import { validateAccountPassword } from "@/lib/password-validation";
import { requestPasswordReset, RESET_REQUEST_MESSAGE } from "@/lib/password-reset-api";
import { GoogleSignIn } from "./google-signin";

type Fields = {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  password: string;
  confirm: string;
};

export function AuthScreen({ mode }: { mode: "login" | "signup" | "forgot" }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [accountCreated, setAccountCreated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { register, handleSubmit, setError, resetField, formState: { errors, isSubmitting } } = useForm<Fields>({
    defaultValues: { firstName: "", middleName: "", lastName: "", email: "", password: "", confirm: "" },
  });

  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const title = signup ? "Create your workspace" : forgot ? "Reset your password" : "Sign in to your workspace";

  const submit = handleSubmit(async (data) => {
    if (googleBusy) return;
    setMessage("");
    const email = data.email.trim().toLowerCase();
    if (!z.string().email().safeParse(email).success) {
      setError("email", { message: "Enter a valid email address." });
      return;
    }
    if (signup && data.password !== data.confirm) {
      setError("confirm", { message: "Passwords must match." });
      return;
    }
    if (forgot) {
      const result = await requestPasswordReset(email);
      if (!result.ok) setError("root.server", { message: result.message });
      else setMessage(RESET_REQUEST_MESSAGE);
      return;
    }
    if (signup) {
      if (accountCreated) return;
      const result = await registerAccount({
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        email,
        password: data.password,
      });
      if (!result.ok) {
        let hasFieldErrors = false;
        for (const field of ["firstName", "middleName", "lastName", "email", "password"] as const) {
          const fieldMessage = result.fields?.[field];
          if (fieldMessage) {
            setError(field, { type: "server", message: fieldMessage });
            hasFieldErrors = true;
          }
        }
        if (!hasFieldErrors) setError("root.server", { message: result.message });
        return;
      }
      resetField("password");
      resetField("confirm");
      setAccountCreated(true);
      setMessage("Account created. Please sign in.");
      return;
    }
    if (signedIn) return;
    const result = await signInAccount({ email, password: data.password });
    if (!result.ok) {
      setError("root.server", { message: result.message });
      return;
    }
    resetField("password");
    setSignedIn(true);
    router.replace("/app/dashboard");
  });

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link href="/" className="back-link"><ArrowLeft /> Back to home</Link>
        <div className="auth-box">
          <Link className="brand" href="/">GUARDRAIL</Link>
          <div>
            <span className="eyebrow">{signup ? "ACCOUNT REGISTRATION" : forgot ? "PASSWORD RECOVERY" : "ACCOUNT SIGN-IN"}</span>
            <h1>{title}</h1>
            <p>{signup ? "Create a real account. Sign in separately after registration." : forgot ? "Enter your email. If an account exists, we'll send password reset instructions." : "Sign in with your registered email and password."}</p>
          </div>
          <SessionNotice />
          <form onSubmit={submit} noValidate>
            {signup && <>
              <label>
                First name
                <input {...register("firstName", {
                  required: "Enter your first name.",
                  validate: (value) => !!value.trim() || "Enter your first name.",
                  maxLength: { value: 60, message: "Use no more than 60 characters." },
                })} maxLength={60} autoComplete="given-name" readOnly={accountCreated} aria-invalid={!!errors.firstName} aria-describedby={errors.firstName ? "first-name-error" : undefined} />
                {errors.firstName && <span id="first-name-error" className="field-error" role="alert">{errors.firstName.message}</span>}
              </label>
              <label>
                Middle name (optional)
                <input {...register("middleName", { maxLength: { value: 60, message: "Use no more than 60 characters." } })} maxLength={60} autoComplete="additional-name" readOnly={accountCreated} aria-invalid={!!errors.middleName} aria-describedby={errors.middleName ? "middle-name-error" : undefined} />
                {errors.middleName && <span id="middle-name-error" className="field-error" role="alert">{errors.middleName.message}</span>}
              </label>
              <label>
                Last name
                <input {...register("lastName", {
                  required: "Enter your last name.",
                  validate: (value) => !!value.trim() || "Enter your last name.",
                  maxLength: { value: 60, message: "Use no more than 60 characters." },
                })} maxLength={60} autoComplete="family-name" readOnly={accountCreated} aria-invalid={!!errors.lastName} aria-describedby={errors.lastName ? "last-name-error" : undefined} />
                {errors.lastName && <span id="last-name-error" className="field-error" role="alert">{errors.lastName.message}</span>}
              </label>
            </>}
            <label>
              Email address
              <input type="email" {...register("email", { required: "Enter an email address." })} placeholder="you@gmail.com" autoComplete="email" readOnly={signup && accountCreated} aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} />
              {errors.email && <span id="email-error" className="field-error" role="alert">{errors.email.message}</span>}
            </label>
            {!forgot && <label htmlFor="auth-password">
              Password
              <span className="password-input">
              <input id="auth-password" type={showPassword ? "text" : "password"} {...register("password", {
                required: "Enter a password.",
                validate: (value) => signup ? validateAccountPassword(value) : new TextEncoder().encode(value).length <= 72 || "Use no more than 72 UTF-8 bytes.",
              })} autoComplete={signup ? "new-password" : "current-password"} readOnly={signup && accountCreated} placeholder={signup ? "Password" : "Enter your password"} aria-label="Password" aria-invalid={!!errors.password} aria-describedby={signup ? `password-help${errors.password ? " password-error" : ""}` : errors.password ? "password-error" : undefined} />
              <button className="password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls="auth-password" disabled={signup && accountCreated} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </span>
              {signup && <small id="password-help">Use at least 8 characters, including uppercase, lowercase, a number, and a special character. Maximum 72 UTF-8 bytes; spaces are allowed.</small>}
              {errors.password && <span id="password-error" className="field-error" role="alert">{errors.password.message}</span>}
            </label>}
            {signup && <>
              <label htmlFor="auth-confirm-password">
                Confirm password
                <span className="password-input">
                <input id="auth-confirm-password" type={showConfirm ? "text" : "password"} {...register("confirm", { required: "Confirm your password." })} autoComplete="new-password" readOnly={accountCreated} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? "confirm-error" : undefined} />
                <button className="password-toggle" type="button" aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirm} aria-controls="auth-confirm-password" disabled={accountCreated} onClick={() => setShowConfirm((visible) => !visible)}>{showConfirm ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
                </span>
                {errors.confirm && <span id="confirm-error" className="field-error" role="alert">{errors.confirm.message}</span>}
              </label>
            </>}
            {mode === "login" && <div className="form-row"><span>Use your registered account</span><Link href="/forgot-password">Forgot password?</Link></div>}
            <button className="button auth-submit" type="submit" disabled={isSubmitting || googleBusy || signedIn || (signup && accountCreated)}>{isSubmitting ? "Please wait..." : forgot ? "Send reset link" : signup ? accountCreated ? "Account created" : "Create account" : signedIn ? "Signed in" : "Sign in"}</button>
            {errors.root?.server && <div className="field-error" role="alert">{errors.root.server.message}</div>}
            {message && <div className="feedback" role="status">{message}{signup && accountCreated && <> <Link href="/login">Go to sign in</Link></>}</div>}
          </form>
          {!forgot && <GoogleSignIn key={mode} mode={signup ? "signup" : "login"} disabled={isSubmitting || signedIn || accountCreated} onBusy={setGoogleBusy} onSuccess={() => { resetField("password"); resetField("confirm"); setSignedIn(true); router.replace("/app/dashboard"); }} />}
          <p className="auth-foot">{signup || forgot ? <Link href="/login">Back to sign in</Link> : <>New here? <Link href="/signup">Create an account</Link></>}</p>
          <Link className="full-link" href="/app/dashboard" onClick={enterDemoSession}>Explore without signing in →</Link>
          <p className="muted-copy">{signup ? "Your password is sent to the backend and stored only as a hash. It is not saved in browser storage." : forgot ? "Reset links expire after a short time and can be used once." : "Your password is sent securely to the backend over HTTPS in production. It is never saved in browser storage."}</p>
        </div>
      </section>
      <aside className="auth-art"><div><ShieldCheck /><h2>Your data deserves<br />a second thought.</h2><p>Every recommendation is transparent. Every destructive action waits for you.</p></div></aside>
    </main>
  );
}
