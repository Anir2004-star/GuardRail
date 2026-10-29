import assert from "node:assert/strict";
import console from "node:console";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma } from "../dist/generated/prisma/client.js";
import { errorHandler } from "../dist/middleware/error-handler.js";

function databaseError(code, meta) {
  return new Prisma.PrismaClientKnownRequestError("PRIVATE_DATABASE_DETAILS", {
    code, clientVersion: "7.10.1", meta,
  });
}

test("email conflicts return safe 409 responses; other errors stay generic", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  const cases = [
    { error: databaseError("P2002", { modelName: "User", target: ["email"] }), status: 409 },
    { error: databaseError("P2002", { target: ["email"] }), status: 409 },
    { error: databaseError("P2002", { modelName: "User", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["email"] } } } }), status: 409 },
    { error: databaseError("P2002", { modelName: "User", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { index: "users_email_key" } } } }), status: 409 },
    { error: databaseError("P2002", { modelName: "User", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { index: "users_pkey" } } } }), status: 500 },
    { error: databaseError("P2002", { modelName: "RefreshSession", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["email"] } } } }), status: 500 },
    { error: databaseError("P2002", { modelName: "User", driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["token_hash"] } } } }), status: 500 },
    { error: databaseError("P2002", { driverAdapterError: { cause: { kind: "OtherError", constraint: { fields: ["email"] } } } }), status: 500 },
    { error: databaseError("P2002", { modelName: "RefreshSession", target: ["token_hash"] }), status: 500 },
    { error: databaseError("P2002", { modelName: "Other", target: ["email"] }), status: 500 },
    { error: databaseError("P2002", { target: ["email", "id"] }), status: 500 },
    { error: databaseError("P2003", { target: ["email"] }), status: 500 },
    { error: databaseError("P2002", {}), status: 500 },
    { error: { code: "P2002", meta: { target: ["email"] } }, status: 500 },
  ];
  const fixture = express();
  cases.forEach(({ error }, index) => {
    fixture.post(`/case-${index}`, (_request, _response, next) => next(error));
  });
  fixture.use(errorHandler);
  const server = fixture.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    for (const [index, { status }] of cases.entries()) {
      const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/case-${index}`, { method: "POST" });
      assert.equal(response.status, status);
      const body = await response.json();
      if (status === 409) {
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(body, { error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists." } });
      } else {
        assert.deepEqual(body, { error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" } });
      }
      assert.ok(!JSON.stringify(body).includes("PRIVATE_DATABASE_DETAILS"));
    }
    assert.equal(logger.mock.calls.length, cases.filter(({ status }) => status === 500).length);
    assert.ok(logger.mock.calls.every((call) => call.arguments.length === 1 && call.arguments[0] === "Unexpected request error"));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
