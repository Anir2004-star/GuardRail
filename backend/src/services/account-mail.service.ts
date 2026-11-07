import nodemailer from "nodemailer";
import { passwordResetEnv as mail } from "../config/password-reset.js";

export async function sendAccountMail(email: string, subject: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: mail.host, port: mail.port, secure: mail.secure, requireTLS: mail.requireTLS,
    ...(mail.user && mail.password ? { auth: { user: mail.user, pass: mail.password } } : {}),
    connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000,
    tls: { minVersion: "TLSv1.2" }, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  });
  await transport.sendMail({ from: mail.from, to: email, subject, text });
}
