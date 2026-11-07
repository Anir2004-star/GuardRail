import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { generateRefreshToken, hashRefreshToken, type RefreshToken } from "../auth/refresh-tokens.js";
import { prisma } from "../config/database.js";
import { InvalidRefreshTokenError } from "../errors/auth.errors.js";
import { createAccessToken, type AccessTokenResult } from "../auth/access-tokens.js";
import { safeUserFields } from "../auth/user-profile.js";
import { assertEmailAccess } from "../auth/email-verification.js";

export type RefreshSessionResult = Readonly<{
  sessionId: string;
  familyId: string;
  expiresAt: Date;
  token: RefreshToken;
}>;

type SafeUser = Prisma.UserGetPayload<{ select: typeof safeUserFields }>;

export type RefreshResult = {
  body: AccessTokenResult & { user: SafeUser };
  refresh: RefreshSessionResult;
};

// The caller supplies its shared-client transaction: no second Prisma client.
export async function createRefreshSession(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<RefreshSessionResult> {
  const token = generateRefreshToken();
  const id = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + env.REFRESH_SESSION_TTL_SECONDS * 1_000);
  await transaction.refreshSession.create({
    data: {
      id,
      userId,
      tokenHash: hashRefreshToken(token.value),
      familyId: id,
      createdAt,
      expiresAt,
    },
    select: { id: true },
  });
  return Object.freeze({ sessionId: id, familyId: id, expiresAt, token });
}

export async function rotateRefreshSession(rawToken: unknown): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(rawToken);
  const result = await prisma.$transaction(async (transaction: Prisma.TransactionClient): Promise<RefreshResult | null> => {
    const hint = await transaction.refreshSession.findUnique({ where: { tokenHash }, select: { userId: true } });
    if (!hint) return null;

    // Serialize every family's rotation/replay for this user. Locking only the
    // presented token would let an ancestor replay race with descendant rotation.
    // Use the same user-first lock order as login and future account revocation.
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${hint.userId}::uuid FOR UPDATE`;
    const session = await transaction.refreshSession.findUnique({ where: { tokenHash } });
    if (!session) return null;
    const now = new Date();
    if (session.revokedAt || session.replacedById) {
      await transaction.refreshSession.updateMany({
        where: { userId: session.userId, familyId: session.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Return, rather than throw: family revocation must COMMIT before the 401.
      return null;
    }
    if (session.expiresAt.getTime() <= now.getTime()) return null;
    const account = await transaction.user.findUnique({ where: { id: session.userId }, select: { ...safeUserFields, emailVerifiedAt: true, emailVerificationExempt: true } });
    if (!account) return null;
    const { emailVerifiedAt, emailVerificationExempt, ...user } = account;
    assertEmailAccess({ emailVerifiedAt, emailVerificationExempt });

    const token = generateRefreshToken();
    const id = randomUUID();
    await transaction.refreshSession.create({
      data: {
        id, userId: session.userId, familyId: session.familyId,
        tokenHash: hashRefreshToken(token.value), createdAt: now,
        // Keep the original absolute session deadline; rotation cannot extend it.
        expiresAt: session.expiresAt,
      },
      select: { id: true },
    });
    await transaction.refreshSession.update({
      where: { id: session.id }, data: { revokedAt: now, replacedById: id },
    });
    const access = await createAccessToken(user.id);
    return {
      body: { user, ...access },
      refresh: { sessionId: id, familyId: session.familyId, expiresAt: session.expiresAt, token },
    };
  }, { maxWait: 5_000, timeout: 10_000 });
  if (!result) throw new InvalidRefreshTokenError();
  return result;
}

export async function revokeRefreshFamily(rawToken: unknown): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);
  await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
    const hint = await transaction.refreshSession.findUnique({ where: { tokenHash }, select: { userId: true } });
    if (!hint) return;
    // Same user-first lock order as login/rotation. An old rotated cookie can
    // still identify and revoke the current descendant, including during a race.
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${hint.userId}::uuid FOR UPDATE`;
    const session = await transaction.refreshSession.findUnique({
      where: { tokenHash }, select: { userId: true, familyId: true },
    });
    if (!session) return;
    await transaction.refreshSession.updateMany({
      where: { userId: session.userId, familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }, { maxWait: 5_000, timeout: 10_000 });
}
