import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Guardrail — Safe AI-powered storage cleanup",
  description:
    "An assistant for organizing Gmail and Google Drive content, reviewing cleanup suggestions, and monitoring registered-device storage.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
