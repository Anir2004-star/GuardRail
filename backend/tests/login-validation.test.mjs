import assert from "node:assert/strict";
import console from "node:console";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { InputValidationError, parseLoginInput } from "../dist/validation/auth.validation.js";
import { validateLogin } from "../dist/middleware/validate-login.js";
import { errorHandler } from "../dist/middleware/error-handler.js";

const sample = { email: "person@example.org", password: "  My strong Passphrase!42  " };

test("login trims and lowercases email while preserving the exact password", () => {
  const input = { ...sample, email: " Person.Name+tag@Example.ORG " };
  const parsed = parseLoginInput(input);
  assert.deepEqual(parsed, { email: "person.name+tag@example.org", password: sample.password });
  assert.equal(input.email, " Person.Name+tag@Example.ORG ");
  assert.equal(parseLoginInput({ ...sample, email: "Person.Name+tag@GMAIL.COM" }).email, "person.name+tag@gmail.com");
});

test("login rejects missing, invalid and non-string emails", () => {
  for (const email of [undefined, null, "", "   ", 123, [], {}, "person@", "not-an-email", "person name@example.org"]) {
    assert.throws(() => parseLoginInput({ ...sample, email }), InputValidationError);
  }
});

test("login requires a nonempty string password without coercion", () => {
  for (const password of [undefined, null, "", 123, [], {}]) {
    assert.throws(() => parseLoginInput({ ...sample, password }), InputValidationError);
  }
});

test("login enforces bcrypt's 72-byte boundary for ASCII and multibyte passwords", () => {
  for (const password of ["a".repeat(72), "é".repeat(36)]) {
    assert.equal(parseLoginInput({ ...sample, password }).password, password);
  }
  for (const password of ["a".repeat(73), "é".repeat(36) + "a", "😀".repeat(19)]) {
    assert.throws(() => parseLoginInput({ ...sample, password }), InputValidationError);
  }
});

test("login does not impose signup composition rules or alter Unicode/whitespace", () => {
  for (const password of ["existing-password", "   ", " e\u0301 😀 !42 "]) {
    assert.equal(parseLoginInput({ ...sample, password }).password, password);
  }
});

test("login rejects non-object bodies and extra fields without exposing input or unknown keys", () => {
  for (const input of [undefined, null, [], "PRIVATE_INPUT_VALUE", 42, { ...sample, firstName: "Unexpected" }, { ...sample, PRIVATE_INPUT_KEY: "PRIVATE_INPUT_VALUE" }]) {
    assert.throws(() => parseLoginInput(input), (error) => {
      assert.ok(error instanceof InputValidationError);
      const output = JSON.stringify({ message: error.message, fields: error.fields });
      assert.ok(!output.includes("PRIVATE_INPUT_VALUE"));
      assert.ok(!output.includes("PRIVATE_INPUT_KEY"));
      assert.ok(!output.includes(sample.password));
      return true;
    });
  }
});

test("login middleware returns safe 400 errors and passes normalized input onward", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  let accepted;
  const fixture = express();
  fixture.use(express.json());
  // Test-only endpoint: no credential checks or public login route yet.
  fixture.post("/login", validateLogin, (request, response) => {
    accepted = request.body;
    response.status(204).end();
  });
  fixture.use(errorHandler);
  const server = fixture.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/login`;
  try {
    const password = "PRIVATE_OVERSIZED_PASSWORD".repeat(4);
    const response = await globalThis.fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid", password }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.ok(body.error.fields.email.length);
    assert.ok(body.error.fields.password.length);
    assert.ok(!JSON.stringify(body).includes(password));
    assert.equal(accepted, undefined);
    assert.equal(logger.mock.calls.length, 0);

    const success = await globalThis.fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sample, email: " Person@Example.org " }),
    });
    assert.equal(success.status, 204);
    assert.equal(success.headers.get("cache-control"), "no-store");
    assert.deepEqual(accepted, sample);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
