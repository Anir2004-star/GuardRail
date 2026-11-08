# Gmail SMTP for local Guardrail testing

This setup sends verification and password-reset messages from a Gmail account
you control. Recipients can use any supported email provider. It is separate from
Google sign-in: the Google OAuth client ID/secret do not provide SMTP access.

## 1. Create the sending credential

1. Sign into the Gmail account that should send Guardrail messages.
2. Open [Google Account Security](https://myaccount.google.com/security).
3. Enable **2-Step Verification** if it is not already enabled.
4. Open [App Passwords](https://myaccount.google.com/apppasswords).
5. Create an App Password named **GuardRail Local**.
6. Keep it private. Enter it only in the local backend environment file.

Google requires 2-Step Verification for App Passwords. The option can be unavailable
for some work/school accounts, security-key-only configurations or Advanced
Protection. See [Google's App Password help](https://support.google.com/accounts/answer/185833).
Changing your Google Account password revokes App Passwords; create a new one if
SMTP authentication stops working after such a change.

## 2. Update the correct file

In VS Code, open:

`C:\Users\ACER\OneDrive\Desktop\GuardRail\backend\.env`

Keep the existing database, JWT, Google client ID and token settings. Add or replace
these six settings, with only one active line for each key:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-sender@gmail.com
SMTP_PASSWORD=YOUR_GOOGLE_APP_PASSWORD
MAIL_FROM=your-sender@gmail.com
```

Replace both email placeholders with the same complete sending address. Replace
the entire password placeholder with the Google-generated App Password, not your
normal Gmail password or OAuth client secret. Google may display the password in
groups; Guardrail removes those display spaces only for `smtp.gmail.com`.

Press **Ctrl+S**. These settings belong in `backend/.env`, not the frontend's
`.env.local`, `.env.postgres`, or an example file. Do not add duplicate keys. The
private file is excluded from Git; never paste its contents into chat/screenshots.

Port 587 starts SMTP and then requires STARTTLS before authentication. An alternative
is `SMTP_PORT=465` with `SMTP_SECURE=true` for TLS from connection start. Certificate
verification remains enabled. Guardrail validates the Gmail port/TLS pairing,
App Password format and matching sender before attempting delivery.

## 3. Verify connection and authentication

Open a terminal in `GuardRail\backend` and run:

```cmd
npm run mail:verify
```

This verifies DNS/connection, TLS and authentication without sending a message.
It prints no credentials or addresses. Local Mailpit settings are explicitly
reported as not ready for real delivery. Errors use local static messages rather
than raw provider errors, which can contain sensitive values.

Successful authentication does not prove sender permission or inbox delivery.
See [Nodemailer's verification documentation](https://nodemailer.com/smtp#verifying-the-configuration).

## 4. Send one explicit test email

Replace the example recipient with an inbox you control:

```cmd
npm run mail:test -- --to your-recipient@gmail.com
```

This sends a plain setup message containing no passwords, reset links or tokens.
There is no default recipient and verification mode never sends mail. The CLI
reports SMTP acceptance, not guaranteed inbox arrival. Check Inbox and Spam.
No test email is sent automatically by starting the backend or running tests.

## 5. Restart and test the application

After changing the private environment, restart the backend: press **Ctrl+C** in
its terminal and run `npm run dev` from `backend`. Keep the frontend running on
`http://localhost:3000`; `FRONTEND_ORIGIN` must match that origin.

1. Create a new email/password account using an inbox you control.
2. Find the verification message in that real inbox and open its link on the same
   computer running Guardrail. Click **Verify email**, then sign in separately.
3. Log out, open **Forgot password**, enter the same email, and use the reset link
   from the real inbox. Then sign in with the new password.

Local links point to `localhost`, so opening them on a phone refers to the phone,
not your development computer. A deployed app needs its deployed HTTPS origin.
Mailpit does not receive messages while Gmail SMTP is selected.

If you need another link, use resend after the existing 60-second cooldown.
An acknowledged signup/resend means work was queued, not that Gmail delivered it.

## Return to local Mailpit

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
MAIL_FROM=guardrail@example.invalid
```

Remove/comment `SMTP_USER` and `SMTP_PASSWORD` together, restart the backend, and
read local captured mail at `http://localhost:8025`. Keep the App Password private
or revoke **GuardRail Local** in Google Account settings when it is no longer used.

Gmail is used here for local testing. For deployment, use a suitable transactional
sender and provider-verified domain; configure that provider's SMTP settings instead.
No Gmail/Drive data permissions are added by this setup.

Reference: [Google's Gmail SMTP settings](https://developers.google.com/workspace/gmail/imap/imap-smtp).
