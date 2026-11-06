import type { Metadata } from "next";
import { ResetPasswordScreen } from "@/components/reset-password-screen";

export const metadata: Metadata = { title: "Reset your password | Guardrail", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function ResetPasswordPage() { return <ResetPasswordScreen />; }
