import type { Prisma } from "../generated/prisma/client.js";

// Shared explicit allowlist for login and refresh responses.
export const safeUserFields = {
  id: true,
  name: true,
  firstName: true,
  middleName: true,
  lastName: true,
  email: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof safeUserFields }>;
