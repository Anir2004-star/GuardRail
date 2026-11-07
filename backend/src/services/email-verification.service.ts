import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { passwordResetEnv as mail } from "../config/password-reset.js";
import { sendAccountMail } from "./account-mail.service.js";
import { generateVerificationToken, hashVerificationToken, invalidVerification, parseVerificationEmail, parseVerificationToken, verificationTtl, verificationUnavailable } from "../auth/email-verification.js";

const ttlSeconds = verificationTtl();
const queue: string[] = [];
let worker: Promise<void> | undefined;
async function deliver(email: string): Promise<void> {
  const hint = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!hint) return;
  const issued = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${hint.id}::uuid FOR UPDATE`;
    const user = await transaction.user.findUnique({ where: { id: hint.id }, select: { email: true, emailVerifiedAt: true } });
    if (!user || user.email !== email || user.emailVerifiedAt) return null;
    const now = new Date();
    const latest = await transaction.emailVerificationToken.findFirst({ where: { userId: hint.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (latest && now.getTime() - latest.createdAt.getTime() < 60000) return null;
    const secret = generateVerificationToken();
    await transaction.emailVerificationToken.updateMany({ where: { userId: hint.id, usedAt: null }, data: { usedAt: now } });
    const row = await transaction.emailVerificationToken.create({ data: { userId: hint.id, email, tokenHash: hashVerificationToken(secret.value), createdAt: now, expiresAt: new Date(now.getTime() + ttlSeconds * 1000) }, select: { id: true } });
    return { id: row.id, secret };
  }, { maxWait: 5000, timeout: 10000 });
  if (!issued) return;
  const link = new URL("/verify-email", env.FRONTEND_ORIGIN);
  link.hash = `token=${issued.secret.value}`;
  try {
    await sendAccountMail(email, "Verify your Guardrail email", `Confirm your email address by opening this link and choosing Verify email:\n\n${link.toString()}\n\nThis link expires in ${ttlSeconds / 60} minutes and works once. It does not sign you in. If you did not create this account, ignore this email.`);
  } catch {
    await prisma.emailVerificationToken.updateMany({ where: { id: issued.id, usedAt: null }, data: { usedAt: new Date() } });
    throw new Error("Verification delivery failed");
  }
}
export function requestEmailVerification(input: unknown): void {
  const email = parseVerificationEmail(input);
  // Queue every valid address before lookup so unknown/already verified users
  // receive the same response, without awaiting SMTP or exposing account state.
  if (!mail.host || !mail.from || (env.NODE_ENV === "production" && !env.FRONTEND_ORIGIN.startsWith("https://")) || queue.length + (worker ? 1 : 0) >= 100) throw verificationUnavailable();
  queue.push(email);
  if (!worker) worker = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
    while (queue.length) {
      try { await deliver(queue.shift()!); } catch { console.error("Email verification processing failed"); }
    }
  }).finally(() => { worker = undefined; });
}
export async function drainVerificationEmails(): Promise<void> { while (worker) await worker; }
export async function confirmEmailVerification(input: unknown): Promise<void> {
  const tokenHash = parseVerificationToken(input);
  const hint = await prisma.emailVerificationToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  if (!hint) throw invalidVerification();
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${hint.userId}::uuid FOR UPDATE`;
    const token = await transaction.emailVerificationToken.findUnique({ where: { tokenHash } });
    const user = await transaction.user.findUnique({ where: { id: hint.userId }, select: { email: true, emailVerifiedAt: true } });
    const now = new Date();
    if (!token || !user || user.emailVerifiedAt || user.email !== token.email || token.usedAt || token.expiresAt.getTime() <= now.getTime()) throw invalidVerification();
    await transaction.user.update({ where: { id: hint.userId }, data: { emailVerifiedAt: now, emailVerificationExempt: false } });
    await transaction.emailVerificationToken.updateMany({ where: { userId: hint.userId, usedAt: null }, data: { usedAt: now } });
  }, { maxWait: 5000, timeout: 10000 });
}
