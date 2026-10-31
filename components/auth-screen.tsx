"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useDemo } from "./demo-store";
import { registerAccount } from "@/lib/registration-api";

type Fields = {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  password: string;
  confirm: string;
  terms: boolean;
};

function validateSignupPassword(value: string): true | string {
  if (Array.from(value).length < 15) return "Use at least 15 characters.";
  if (new TextEncoder().encode(value).length > 72) return "Use no more than 72 UTF-8 bytes.";
  if (!/[A-Z]/.test(value)) return "Include at least one uppercase letter.";
  if (!/[a-z]/.test(value)) return "Include at least one lowercase letter.";
  if (!/[0-9]/.test(value)) return "Include at least one number.";
  if (!/[^\p{L}\p{N}\s]/u.test(value)) return "Include at least one special character, such as ! or @.";
  return true;
}

export function AuthScreen({ mode }: { mode: "login" | "signup" | "forgot" }) {
  const router = useRouter();
  const state = useDemo();
  const [message, setMessage] = useState("");
  const [accountCreated, setAccountCreated] = useState(false);
  const { register, handleSubmit, setError, resetField, formState: { errors, isSubmitting } } = useForm<Fields>({
    defaultValues: { firstName: "", middleName: "", lastName: "", email: "", password: "", confirm: "", terms: false },
  });

  useEffect(() => { void useDemo.persist.rehydrate(); }, []);

  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const title = signup ? "Create your workspace" : forgot ? "Reset your password" : "Sign in to your workspace";

  const submit = handleSubmit(async (data) => {
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
      setMessage("Password reset is not connected yet. No email was sent. You can continue exploring the demo.");
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
    // Sign-in still explores the demo; it does not authenticate a backend user.
    state.saveSettings({ name: state.profile.name, email }, state.preferences);
    router.push("/app/dashboard");
  });

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link href="/" className="back-link"><ArrowLeft /> Back to home</Link>
        <div className="auth-box">
          <Link className="brand" href="/">GUARDRAIL</Link>
          <div>
            <span className="eyebrow">{signup ? "ACCOUNT REGISTRATION" : "FRONTEND DEMO"}</span>
            <h1>{title}</h1>
            <p>{signup ? "Create a real account. Sign in separately after registration." : forgot ? "Preview the reset flow before backend authentication is connected." : "Explore the demo. Real sign-in is not connected yet."}</p>
          </div>
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
              <input type="email" {...register("email", { required: "Enter an email address." })} placeholder="you@example.com" autoComplete="email" readOnly={signup && accountCreated} aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} />
              {errors.email && <span id="email-error" className="field-error" role="alert">{errors.email.message}</span>}
            </label>
            {!forgot && <label>
              Password
              <input type="password" {...register("password", {
                required: "Enter a password.",
                validate: (value) => signup ? validateSignupPassword(value) : true,
              })} autoComplete={signup ? "new-password" : "current-password"} readOnly={signup && accountCreated} placeholder={signup ? "Create a strong passphrase" : "Enter your password"} aria-label="Password" aria-invalid={!!errors.password} aria-describedby={signup ? `password-help${errors.password ? " password-error" : ""}` : errors.password ? "password-error" : undefined} />
              {signup && <small id="password-help">Use at least 15 characters, including uppercase, lowercase, a number, and a special character. Maximum 72 UTF-8 bytes; spaces are allowed.</small>}
              {errors.password && <span id="password-error" className="field-error" role="alert">{errors.password.message}</span>}
            </label>}
            {signup && <>
              <label>
                Confirm password
                <input type="password" {...register("confirm", { required: "Confirm your password." })} autoComplete="new-password" readOnly={accountCreated} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? "confirm-error" : undefined} />
                {errors.confirm && <span id="confirm-error" className="field-error" role="alert">{errors.confirm.message}</span>}
              </label>
              <label className="check-row">
                <input type="checkbox" {...register("terms", { required: "Accept the privacy overview to continue." })} disabled={accountCreated} aria-invalid={!!errors.terms} aria-describedby={errors.terms ? "terms-error" : undefined} />
                <span>I have read the <Link href="/privacy">privacy overview</Link>.</span>
              </label>
              {errors.terms && <span id="terms-error" className="field-error" role="alert">{errors.terms.message}</span>}
            </>}
            {mode === "login" && <div className="form-row"><span>Use demo details</span><Link href="/forgot-password">Forgot password?</Link></div>}
            <button className="button auth-submit" type="submit" disabled={isSubmitting || (signup && accountCreated)}>{isSubmitting ? "Please wait..." : forgot ? "Preview reset request" : signup ? accountCreated ? "Account created" : "Create account" : "Enter demo workspace"}</button>
            {errors.root?.server && <div className="field-error" role="alert">{errors.root.server.message}</div>}
            {message && <div className="feedback" role="status">{message}{signup && accountCreated && <> <Link href="/login">Go to sign in</Link></>}</div>}
          </form>
          <p className="auth-foot">{signup || forgot ? <Link href="/login">Back to sign in</Link> : <>New here? <Link href="/signup">Create an account</Link></>}</p>
          <Link className="full-link" href="/app/dashboard">Explore without signing in →</Link>
          <p className="muted-copy">{signup ? "Your password is sent to the backend and stored only as a hash. It is not saved in browser storage." : "Sign-in and password recovery are still demo flows. Passwords entered here are never saved or sent."}</p>
        </div>
      </section>
      <aside className="auth-art"><div><ShieldCheck /><h2>Your data deserves<br />a second thought.</h2><p>Every recommendation is transparent. Every destructive action waits for you.</p></div></aside>
    </main>
  );
}
