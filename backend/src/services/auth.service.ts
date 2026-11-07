import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import type { Prisma } from "../generated/prisma/client.js";
import { parseLoginInput, parseRegistrationInput } from "../validation/auth.validation.js";
import { InvalidCredentialsError } from "../errors/auth.errors.js";
import { createAccessToken } from "../auth/access-tokens.js";
import { createRefreshSession } from "./refresh-session.service.js";
import { safeUserFields } from "../auth/user-profile.js";

// Precompute once per process at the configured cost, not once per failed login.
// Unknown/passwordless accounts still perform a real asynchronous comparison.
const dummyPasswordHash = bcrypt.hash(randomBytes(32).toString("hex"), env.BCRYPT_ROUNDS);

const credentialUserFields = { ...safeUserFields, passwordHash: true } satisfies Prisma.UserSelect;
type CredentialUser = Prisma.UserGetPayload<{ select: typeof credentialUserFields }>;

function safeProfile(user: CredentialUser) {
  return {
    id: user.id,
    name: user.name,
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    email: user.email,
    createdAt: user.createdAt,
  };
}

export async function registerUser(input: unknown) {
  // Revalidate at the service boundary, including calls outside an HTTP route.
  const data = parseRegistrationInput(input);
  const passwordHash = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);

  // The database's unique constraint is authoritative, including concurrent
  // requests. Let its P2002 error reach the existing safe 409 error handler.
  return prisma.user.create({
    data: {
      firstName: data.firstName,
      middleName: data.middleName || null,
      lastName: data.lastName,
      name: [data.firstName, data.middleName, data.lastName].filter(Boolean).join(" "),
      email: data.email,
      passwordHash,
    },
    select: safeUserFields,
  });
}

// Server-only credential snapshot; callers must never return its hash in JSON.
export async function verifyPasswordAccount(input: unknown) {
  const data = parseLoginInput(input);
  const user = await prisma.user.findUnique({
    where: { email: data.email },
    select: credentialUserFields,
  });
  const hash = user?.passwordHash || await dummyPasswordHash;
  const matches = await bcrypt.compare(data.password, hash);

  if (!user || !user.passwordHash || !matches) throw new InvalidCredentialsError();

  return user;
}

export async function verifyLoginCredentials(input: unknown) {
  return safeProfile(await verifyPasswordAccount(input));
}

// Internal access-only building block. Use createLoginSession for full login.
export async function createLoginAccess(input: unknown) {
  const user = await verifyLoginCredentials(input);
  const access = await createAccessToken(user.id);
  return { user, ...access };
}

// Internal full login assembly. The login controller sends only .body as JSON
// and uses .refresh.token.value only when setting the HttpOnly cookie.
export async function createLoginSession(input: unknown) {
  // Keep expensive bcrypt work outside the transaction.
  const verified = await verifyPasswordAccount(input);
  return prisma.$transaction(async (transaction) => {
    // Coordinate session creation with deletion or a future password change.
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${verified.id}::uuid FOR UPDATE`;
    const current = await transaction.user.findUnique({ where: { id: verified.id }, select: credentialUserFields });
    if (!current || current.passwordHash !== verified.passwordHash || current.email !== verified.email) {
      throw new InvalidCredentialsError();
    }
    const access = await createAccessToken(current.id);
    const refresh = await createRefreshSession(transaction, current.id);
    return { body: { user: safeProfile(current), ...access }, refresh };
  }, { maxWait: 5_000, timeout: 10_000 });
}
