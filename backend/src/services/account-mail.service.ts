import nodemailer from "nodemailer";
import { passwordResetEnv as mail } from "../config/password-reset.js";

export function createAccountMailTransport() {
  if (!mail.host || !mail.from) throw new Error("Account SMTP is not configured.");
  return nodemailer.createTransport({
    host: mail.host, port: mail.port, secure: mail.secure, requireTLS: mail.requireTLS,
    ...(mail.user && mail.password ? { auth: { user: mail.user, pass: mail.password } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 10000,
    tls: { minVersion: "TLSv1.2" }, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

export async function verifyAccountMailTransport(): Promise<void> {
  const transport = createAccountMailTransport();
  try { await transport.verify(); } finally { transport.close(); }
}

export async function sendAccountMail(email: string, subject: string, text: string): Promise<void> {
  const transport = createAccountMailTransport();
  try { await transport.sendMail({ from: mail.from, to: email, subject, text }); } finally { transport.close(); }
}
