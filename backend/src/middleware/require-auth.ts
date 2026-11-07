import type { Request, RequestHandler } from "express";
import type { ParamsDictionary, Query } from "express-serve-static-core";
import { verifyAccessToken } from "../auth/access-tokens.js";
import { safeUserFields, type SafeUser } from "../auth/user-profile.js";
import { prisma } from "../config/database.js";
import { InvalidAccessTokenError } from "../errors/auth.errors.js";
import { assertEmailAccess } from "../auth/email-verification.js";

export type AuthenticatedHandler = RequestHandler<ParamsDictionary, unknown, unknown, Query, { authUser: SafeUser }>;

export function readBearerToken(request: Pick<Request, "headers" | "rawHeaders">): string {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") count++;
  }
  const value = request.headers.authorization;
  if (count !== 1 || !value || value.length > 4103) throw new InvalidAccessTokenError();
  const match = /^Bearer +([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(value);
  if (!match?.[1]) throw new InvalidAccessTokenError();
  return match[1];
}

export const requireAuth: AuthenticatedHandler = async (request, response, next) => {
  response.set("Cache-Control", "no-store");
  const verified = await verifyAccessToken(readBearerToken(request));
  // Only the verified subject identifies the account. Client IDs, cookies and
  // decoded-but-unverified claims never supply this lookup key.
  const user = await prisma.user.findUnique({ where: { id: verified.userId }, select: { ...safeUserFields, emailVerifiedAt: true, emailVerificationExempt: true } });
  if (!user) throw new InvalidAccessTokenError();
  const { emailVerifiedAt, emailVerificationExempt, ...profile } = user;
  assertEmailAccess({ emailVerifiedAt, emailVerificationExempt });
  response.locals.authUser = profile;
  next();
};
