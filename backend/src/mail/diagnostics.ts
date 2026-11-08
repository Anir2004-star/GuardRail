import { z } from "zod";

export class MailSetupError extends Error {}
export type MailCommand = { mode: "verify" } | { mode: "test"; recipient: string };
export function parseMailCommand(args: string[]): MailCommand {
  if (args.length === 1 && args[0] === "verify") return { mode: "verify" };
  if (args.length === 3 && args[0] === "test" && args[1] === "--to") {
    const email = args[2]?.trim().toLowerCase();
    if (email && email.length <= 254 && z.email().safeParse(email).success) return { mode: "test", recipient: email };
  }
  throw new MailSetupError("Use npm run mail:verify, or npm run mail:test -- --to your-email@gmail.com. A test recipient must be supplied explicitly.");
}
export function assertRealMailConfiguration(mail: { host: string | undefined; user: string | undefined; password: string | undefined; from: string | undefined; secure: boolean; requireTLS: boolean }): void {
  if (!mail.host || ["localhost", "127.0.0.1", "::1"].includes(mail.host.toLowerCase())) {
    throw new MailSetupError("Local Mailpit is still selected. Configure Gmail SMTP in backend/.env to enable real delivery.");
  }
  if (!mail.user || !mail.password || !mail.from || mail.from.toLowerCase().endsWith(".invalid")) {
    throw new MailSetupError("Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD and MAIL_FROM in the private backend/.env file.");
  }
  if (!mail.secure && !mail.requireTLS) throw new MailSetupError("Real SMTP requires TLS or STARTTLS. Check your SMTP settings.");
}
export function mailFailureMessage(error: unknown): string {
  if (error instanceof MailSetupError) return error.message;
  const candidate = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
  const code = typeof candidate === "string" ? candidate : "";
  if (code === "EAUTH") return "SMTP authentication failed. For Gmail, confirm 2-Step Verification and use a Google App Password.";
  if (["ETLS", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(code)) return "SMTP TLS verification failed. Check the server, port, system clock and certificate trust.";
  if (["EDNS", "ENOTFOUND", "ECONNECTION", "ECONNREFUSED", "ETIMEDOUT", "ESOCKET"].includes(code)) return "Could not connect to SMTP. Check the host, port, internet connection and firewall.";
  if (["EENVELOPE", "EMESSAGE"].includes(code)) return "SMTP rejected the message. Check the sender, recipient and provider sending permissions.";
  // Never emit raw SMTP errors: these can contain passwords, addresses or URLs.
  return "SMTP setup or operation failed. Check the private backend/.env settings and retry.";
}
