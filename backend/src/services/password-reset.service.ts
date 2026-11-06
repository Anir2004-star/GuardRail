import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { passwordResetEnv as mail } from "../config/password-reset.js";
import { generatePasswordResetToken, hashPasswordResetToken } from "../auth/password-reset-tokens.js";
import { InvalidPasswordResetTokenError, PasswordResetUnavailableError } from "../errors/auth.errors.js";
import { parseForgotPasswordInput, parseResetPasswordInput } from "../validation/auth.validation.js";

type MailJob = { kind: "reset" | "changed"; email: string };
const queue: MailJob[] = [];
let worker: Promise<void> | undefined;

async function sendMail(email: string, subject: string, text: string) {
  if (!mail.host || !mail.from) throw new PasswordResetUnavailableError();
  const transport = nodemailer.createTransport({
    host: mail.host, port: mail.port, secure: mail.secure, requireTLS: mail.requireTLS,
    ...(mail.user && mail.password ? { auth: { user: mail.user, pass: mail.password } } : {}),
    connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000,
    tls: { minVersion: "TLSv1.2" }, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  });
  await transport.sendMail({ from: mail.from, to: email, subject, text });
}

async function deliverReset(email: string) {
  const candidate = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!candidate) return;
  const reset = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`;
    const user = await transaction.user.findUnique({ where: { id: candidate.id }, select: { email: true } });
    if (!user || user.email !== email) return null;
    const now = new Date();
    const last = await transaction.passwordResetToken.findFirst({ where: { userId: candidate.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && now.getTime() - last.createdAt.getTime() < 60_000) return null;
    const secret = generatePasswordResetToken();
    await transaction.passwordResetToken.updateMany({ where: { userId: candidate.id, usedAt: null }, data: { usedAt: now } });
    const token = await transaction.passwordResetToken.create({
      data: { userId: candidate.id, tokenHash: hashPasswordResetToken(secret.value), createdAt: now, expiresAt: new Date(now.getTime() + mail.ttlSeconds * 1000) },
      select: { id: true },
    });
    return { id: token.id, secret };
  }, { maxWait: 5000, timeout: 10000 });
  if (!reset) return;
  const url = new URL("/reset-password", env.FRONTEND_ORIGIN);
  url.hash = `token=${reset.secret.value}`;
  try {
    await sendMail(email, "Reset your Guardrail password", `Use this link to choose a new password:\n\n${url.toString()}\n\nThis link expires in ${mail.ttlSeconds / 60} minutes and works once. If you did not request it, ignore this email. Your password has not changed.`);
  } catch {
    // A failed/uncertain send must not leave an unintentionally usable token.
    await prisma.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
    throw new Error("Password reset delivery failed");
  }
}

function enqueue(job: MailJob) {
  if (!mail.host || !mail.from || (env.NODE_ENV === "production" && !env.FRONTEND_ORIGIN.startsWith("https://")) || queue.length + (worker ? 1 : 0) >= 100) {
    throw new PasswordResetUnavailableError();
  }
  queue.push(job);
  if (!worker) worker = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
    while (queue.length) {
      const next = queue.shift()!;
      try {
        if (next.kind === "reset") await deliverReset(next.email);
        else await sendMail(next.email, "Your Guardrail password changed", "Your Guardrail password was changed. Existing refresh sessions have been revoked. If you did not make this change, request a new password reset immediately.");
      } catch { console.error("Password recovery email processing failed"); }
    }
  }).finally(() => { worker = undefined; });
}

export function requestPasswordReset(input: unknown): void {
  const { email } = parseForgotPasswordInput(input);
  // Enqueue every valid address, including unknown ones, without an account
  // lookup or SMTP wait in the response path. The queue is bounded in memory.
  enqueue({ kind: "reset", email });
}

export async function drainPasswordResetEmails(): Promise<void> {
  while (worker) await worker;
}

export async function resetPassword(input: unknown): Promise<void> {
  const data = parseResetPasswordInput(input);
  const tokenHash = hashPasswordResetToken(data.token);
  const hint = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, select: { userId: true, usedAt: true, expiresAt: true } });
  if (!hint || hint.usedAt || hint.expiresAt.getTime() <= Date.now()) throw new InvalidPasswordResetTokenError();
  const passwordHash = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);
  const email = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${hint.userId}::uuid FOR UPDATE`;
    const token = await transaction.passwordResetToken.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (!token || token.usedAt || token.expiresAt.getTime() <= now.getTime()) throw new InvalidPasswordResetTokenError();
    const user = await transaction.user.update({ where: { id: token.userId }, data: { passwordHash }, select: { email: true } });
    await transaction.passwordResetToken.updateMany({ where: { userId: token.userId, usedAt: null }, data: { usedAt: now } });
    await transaction.refreshSession.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: now } });
    return user.email;
  }, { maxWait: 5000, timeout: 10000 });
  try { enqueue({ kind: "changed", email }); } catch { console.error("Password change notification could not be queued"); }
}
