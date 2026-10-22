import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

const databaseUrl = new URL(env.DATABASE_URL);
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 3_000,
  query_timeout: 3_000,
  statement_timeout: 3_000,
  idleTimeoutMillis: 10_000,
}, {
  schema: databaseUrl.searchParams.get("schema") ?? "public",
});

// Module caching gives every route/service the same pool and client.
// Do not enable query/error logging: driver errors can contain sensitive data.
export const prisma = new PrismaClient({ adapter, log: [] });

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
