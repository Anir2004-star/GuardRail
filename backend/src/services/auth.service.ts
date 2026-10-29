import bcrypt from "bcrypt";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import type { Prisma } from "../generated/prisma/client.js";
import { parseRegistrationInput } from "../validation/auth.validation.js";

const safeUserFields = {
  id: true,
  name: true,
  firstName: true,
  middleName: true,
  lastName: true,
  email: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

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
