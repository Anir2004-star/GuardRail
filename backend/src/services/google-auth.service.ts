import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { GoogleAuthError, googleClientId, googleHash, invalidGoogle, verifyGoogleIdentity } from "../auth/google-identity.js";
import { InputValidationError } from "../validation/auth.validation.js";
import { refreshCookieOptions } from "../auth/refresh-cookie.js";
import { createAccessToken } from "../auth/access-tokens.js";
import { createRefreshSession } from "./refresh-session.service.js";
import { verifyPasswordAccount } from "./auth.service.js";
import { safeUserFields } from "../auth/user-profile.js";
import { Prisma } from "../generated/prisma/client.js";

const cookieName = "guardrail_google_challenge";
const cookieOptions = () => ({ ...refreshCookieOptions(), path: "/api/v1/auth/google" });
const intentSchema = z.enum(["login", "signup", "link"]);
const challengeSchema = z.strictObject({ intent: intentSchema });
const completionSchema = z.strictObject({
  intent: intentSchema, credential: z.string().min(1).max(8192),
  password: z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= 72).optional(),
}).refine((data) => data.intent === "link" ? !!data.password : data.password === undefined);
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputValidationError({ body: ["Check the Google sign-in request."] });
  return result.data;
}
function challengeCookie(request: Pick<Request, "headers">): string {
  const header = request.headers.cookie;
  if (!header || header.length > 8192) throw invalidGoogle();
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`));
  if (matches.length !== 1) throw invalidGoogle();
  const secret = matches[0]!.slice(cookieName.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw invalidGoogle();
  return secret;
}
export async function createGoogleChallenge(input: unknown, response: Response) {
  const { intent } = parse(challengeSchema, input);
  const clientId = googleClientId();
  const nonce = randomBytes(32).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 300_000);
  await prisma.googleChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.googleChallenge.create({ data: { secretHash: googleHash(secret), nonceHash: googleHash(nonce), intent, expiresAt } });
  response.cookie(cookieName, secret, { ...cookieOptions(), expires: expiresAt });
  return { nonce, clientId, expiresIn: 300 };
}
export async function completeGoogleSignIn(input: unknown, request: Pick<Request, "headers">, response: Response) {
  const data = parse(completionSchema, input);
  googleClientId();
  const secretHash = googleHash(challengeCookie(request));
  response.clearCookie(cookieName, cookieOptions());
  const challenge = await prisma.googleChallenge.findUnique({ where: { secretHash } });
  if (!challenge || challenge.intent !== data.intent || challenge.usedAt || challenge.expiresAt.getTime() <= Date.now()) throw invalidGoogle();
  // Consume atomically before external verification. All retries start a fresh flow.
  const consumed = await prisma.googleChallenge.updateMany({ where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (consumed.count !== 1) throw invalidGoogle();
  const identity = await verifyGoogleIdentity(data.credential, challenge.nonceHash);
  // Linking requires BOTH Google proof and the existing account's exact password.
  const verified = data.intent === "link" ? await verifyPasswordAccount({ email: identity.email, password: data.password }) : null;
  try {
    return await prisma.$transaction(async (transaction) => {
      let user = await transaction.user.findUnique({ where: { googleSubject: identity.subject }, select: { id: true } });
      if (data.intent === "signup") {
        if (user || await transaction.user.findUnique({ where: { email: identity.email }, select: { id: true } })) {
          throw new GoogleAuthError(409, "GOOGLE_ACCOUNT_EXISTS", "Account already exists. Sign in, or link it using its password.");
        }
        if (!identity.authoritativeEmail) throw new GoogleAuthError(409, "GOOGLE_EMAIL_VERIFICATION_REQUIRED", "Register with email and password first, then link your Google account.");
        user = await transaction.user.create({ data: { googleSubject: identity.subject, email: identity.email, name: identity.name, firstName: identity.firstName, lastName: identity.lastName }, select: { id: true } });
      } else if (data.intent === "link") {
        if (!verified || (user && user.id !== verified.id)) throw invalidGoogle();
        await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${verified.id}::uuid FOR UPDATE`;
        const current = await transaction.user.findUnique({ where: { id: verified.id }, select: { id: true, email: true, passwordHash: true, googleSubject: true } });
        // Check the verified snapshot under the lock; keep bcrypt outside the transaction.
        if (!current || current.email !== identity.email || current.passwordHash !== verified.passwordHash || (current.googleSubject && current.googleSubject !== identity.subject)) throw invalidGoogle();
        user = await transaction.user.update({ where: { id: current.id }, data: { googleSubject: identity.subject }, select: { id: true } });
      } else if (!user) {
        // Login never creates an account or silently links a matching email.
        throw new GoogleAuthError(409, "GOOGLE_NOT_REGISTERED", "Sign up with Google first, or link your existing account using its password.");
      }
      if (!user) throw invalidGoogle();
      await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const profile = await transaction.user.findUnique({ where: { id: user.id }, select: safeUserFields });
      if (!profile) throw invalidGoogle();
      const access = await createAccessToken(user.id);
      const refresh = await createRefreshSession(transaction, user.id);
      return { body: { user: profile, ...access }, refresh };
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new GoogleAuthError(409, "GOOGLE_ACCOUNT_EXISTS", "Account already exists. Sign in, or link it using its password.");
    }
    throw error;
  }
}
