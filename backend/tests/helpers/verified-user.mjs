import assert from "node:assert/strict";
import process from "node:process";

assert.equal(process.env.NODE_ENV, "test");
assert.match(process.env.GUARDRAIL_REGISTRATION_TEST_DATABASE ?? "", /^guardrail_registration_test_[a-f0-9]{16}$/);
const { registerUser } = await import("../../dist/services/auth.service.js");
const { prisma } = await import("../../dist/config/database.js");

// Explicit verified fixtures for unrelated authentication tests. Production
// registration still creates pending users; there is no test-mode auth bypass.
export async function registerVerifiedUser(input) {
  const user = await registerUser(input);
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return user;
}
