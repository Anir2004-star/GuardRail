import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { generateRefreshToken, hashRefreshToken } from "../auth/refresh-tokens.js";

// The caller supplies its shared-client transaction: no second Prisma client.
export async function createRefreshSession(transaction: Prisma.TransactionClient, userId: string) {
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
