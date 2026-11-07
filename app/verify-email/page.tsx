import type { Metadata } from "next";
import { EmailVerificationScreen } from "@/components/email-verification";

export const metadata: Metadata = { title: "Verify your email | Guardrail", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function VerifyEmailPage() { return <EmailVerificationScreen />; }
