import { assertRealMailConfiguration, mailFailureMessage, parseMailCommand } from "../mail/diagnostics.js";

try {
  const command = parseMailCommand(process.argv.slice(2));
  // Load configuration inside the boundary so invalid configuration also gets
  // sanitized output. Do not import the Express app, Prisma, or any mail queue.
  const { passwordResetEnv: mail } = await import("../config/password-reset.js");
  assertRealMailConfiguration(mail);
  const { sendAccountMail, verifyAccountMailTransport } = await import("../services/account-mail.service.js");
  if (command.mode === "verify") {
    await verifyAccountMailTransport();
    console.log("SMTP connection, TLS and authentication verified. No email was sent. Sender permission and inbox delivery still require a test email.");
  } else {
    await sendAccountMail(command.recipient, "Guardrail email delivery test", "This is a Guardrail SMTP setup test. It contains no passwords, verification links or login tokens. If you requested this test, your mailbox has received the message.");
    console.log("Test email accepted by SMTP. Check the recipient inbox and Spam folder; SMTP acceptance alone does not guarantee delivery.");
  }
} catch (error) {
  console.error(mailFailureMessage(error));
  process.exitCode = 1;
}
