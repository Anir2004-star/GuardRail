"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useDemo } from "./demo-store";

type Fields = { name: string; email: string; password: string; confirm: string; terms: boolean };
export function AuthScreen({ mode }: { mode: "login" | "signup" | "forgot" }) {
  const router = useRouter(); const state = useDemo(); const [message, setMessage] = useState("");
  const { register, handleSubmit, setError, formState: { errors } } = useForm<Fields>();
  useEffect(() => { void useDemo.persist.rehydrate(); }, []);
  const signup = mode === "signup"; const forgot = mode === "forgot";
  const title = signup ? "Create your workspace" : forgot ? "Reset your password" : "Sign in to your workspace";
  const submit = handleSubmit((data) => {
    const result = z.string().email().safeParse(data.email);
    if (!result.success) { setError("email", { message: "Enter a valid email address." }); return; }
    if (signup && data.password !== data.confirm) { setError("confirm", { message: "Passwords must match." }); return; }
    if (forgot) { setMessage("Password reset is not connected yet. No email was sent. You can continue exploring the demo."); return; }
    const name = signup ? data.name.trim() : state.profile.name;
    state.saveSettings({ name, email: data.email }, state.preferences);
    router.push("/app/dashboard");
  });
  return <main className="auth-page"><section className="auth-panel"><Link href="/" className="back-link"><ArrowLeft /> Back to home</Link><div className="auth-box"><Link className="brand" href="/">GUARDRAIL</Link><div><span className="eyebrow">FRONTEND DEMO</span><h1>{title}</h1><p>{forgot ? "Preview the reset flow before backend authentication is connected." : "Try the interface. No real account is created or authenticated."}</p></div><form onSubmit={submit}>{signup && <label>Display name<input {...register("name", { required: "Enter your name.", validate: (v) => !!v.trim() || "Enter your name." })} maxLength={60} autoComplete="name" />{errors.name && <span className="field-error">{errors.name.message}</span>}</label>}<label>Email address<input type="email" {...register("email", { required: "Enter an email address." })} placeholder="you@example.com" autoComplete="email" />{errors.email && <span className="field-error">{errors.email.message}</span>}</label>{!forgot && <label>Password<input type="password" {...register("password", { required: "Enter a demo password.", minLength: { value: 8, message: "Use at least 8 characters." } })} autoComplete={signup ? "new-password" : "current-password"} placeholder="Demo password (8+ characters)" />{errors.password && <span className="field-error">{errors.password.message}</span>}</label>}{signup && <><label>Confirm password<input type="password" {...register("confirm", { required: "Confirm your password." })} autoComplete="new-password" />{errors.confirm && <span className="field-error">{errors.confirm.message}</span>}</label><label className="check-row"><input type="checkbox" {...register("terms", { required: "Accept the privacy overview to continue." })} />I have read the <Link href="/privacy">privacy overview</Link>.</label>{errors.terms && <span className="field-error">{errors.terms.message}</span>}</>}{mode === "login" && <div className="form-row"><span>Use demo details</span><Link href="/forgot-password">Forgot password?</Link></div>}<button className="button auth-submit" type="submit">{forgot ? "Preview reset request" : signup ? "Create demo workspace" : "Enter demo workspace"}</button>{message && <div className="feedback" role="status">{message}</div>}</form><p className="auth-foot">{signup || forgot ? <Link href="/login">Back to sign in</Link> : <>New here? <Link href="/signup">Create a demo workspace</Link></>}</p><Link className="full-link" href="/app/dashboard">Explore without signing in →</Link><p className="muted-copy">Passwords are validated on screen and never saved or sent.</p></div></section><aside className="auth-art"><div><ShieldCheck /><h2>Your data deserves<br />a second thought.</h2><p>Every recommendation is transparent. Every destructive action waits for you.</p></div></aside></main>;
}
