import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { InputValidationError, parseRegistrationInput } from "../dist/validation/auth.validation.js";
import { validateRegistration } from "../dist/middleware/validate-registration.js";
import { errorHandler } from "../dist/middleware/error-handler.js";

const valid = {
  firstName: "Anirban",
  middleName: "",
  lastName: "Roy",
  email: "anirban@example.com",
  password: "My strong Passphrase!42",
};

test("names and emails are normalized, all providers allowed, passwords remain unchanged", () => {
  const password = "  My strong Passphrase!42  ";
  const input = { ...valid, firstName: "  Anirban ", middleName: " Kumar ", lastName: " Roy ", email: "  Anirban.Roy+work@Example.ORG  ", password };
  const parsed = parseRegistrationInput(input);
  assert.equal(parsed.firstName, "Anirban");
  assert.equal(parsed.middleName, "Kumar");
  assert.equal(parsed.lastName, "Roy");
  assert.equal(parsed.email, "anirban.roy+work@example.org");
  assert.equal(parsed.password, password);
  assert.equal(input.firstName, "  Anirban ");
  assert.equal(parseRegistrationInput({ ...valid, email: "Person.Name+tag@GMAIL.COM" }).email, "person.name+tag@gmail.com");
});

test("first and last names are required; middle name is optional; names support Unicode", () => {
  const { middleName: _middle, ...withoutMiddle } = valid;
  assert.equal(parseRegistrationInput(withoutMiddle).middleName, undefined);
  assert.equal(parseRegistrationInput({ ...valid, middleName: "   " }).middleName, "");
  assert.equal(parseRegistrationInput({ ...valid, firstName: "李", lastName: "O’Connor-Smith" }).firstName, "李");
  for (const key of ["firstName", "lastName"]) {
    for (const value of [undefined, null, "", "   ", 123, "a".repeat(61), "A\u0000B"]) {
      assert.throws(() => parseRegistrationInput({ ...valid, [key]: value }), InputValidationError);
    }
  }
  for (const value of [null, 12, "a".repeat(61)]) {
    assert.throws(() => parseRegistrationInput({ ...valid, middleName: value }), InputValidationError);
  }
});

test("invalid emails are rejected without coercion or provider-specific rewriting", () => {
  for (const email of [undefined, null, 42, "", "not-an-email", "person@", "person name@example.com", `${"a".repeat(250)}@example.com`]) {
    assert.throws(() => parseRegistrationInput({ ...valid, email }), InputValidationError);
  }
});

test("password length counts Unicode characters and enforces the 72-byte bcrypt boundary", () => {
  const shortest = "Aa1!" + "b".repeat(11);
  assert.equal(parseRegistrationInput({ ...valid, password: shortest }).password, shortest);
  assert.throws(() => parseRegistrationInput({ ...valid, password: shortest.slice(1) }), InputValidationError);
  const atLimit = "Aa1!" + "é".repeat(34);
  assert.equal(Buffer.byteLength(atLimit), 72);
  assert.equal(parseRegistrationInput({ ...valid, password: atLimit }).password, atLimit);
  assert.throws(() => parseRegistrationInput({ ...valid, password: atLimit + "a" }), InputValidationError);
  assert.throws(() => parseRegistrationInput({ ...valid, password: "Aa1!" + "😀".repeat(6) }), InputValidationError);
});

test("passwords need uppercase, lowercase, a number and a non-space special character", () => {
  for (const password of [undefined, null, 123, "", "a long password!42", "A LONG PASSWORD!42", "A long password!!", "A long password42", "A long passwörd42"]) {
    assert.throws(() => parseRegistrationInput({ ...valid, password }), InputValidationError);
  }
});

test("rejects non-object bodies and extra fields without echoing attacker-controlled keys", () => {
  for (const body of [null, undefined, [], "a-password-in-a-string", 42]) {
    assert.throws(() => parseRegistrationInput(body), InputValidationError);
  }
  const privateKey = "PRIVATE_PASSWORD_IN_PROPERTY_NAME";
  try {
    parseRegistrationInput({ ...valid, [privateKey]: "sensitive value" });
    assert.fail("Expected validation failure");
  } catch (error) {
    assert.ok(error instanceof InputValidationError);
    assert.ok(!JSON.stringify(error).includes(privateKey));
    assert.ok(!JSON.stringify(error).includes(valid.password));
  }
});

test("middleware returns safe HTTP 400 field errors, and passes only normalized valid input onward", async (t) => {
  const logger = t.mock.method(console, "error", () => {});
  let accepted;
  const fixture = express();
  fixture.use(express.json());
  // Test-only route: no public endpoint or database writes are introduced.
  fixture.post("/register", validateRegistration, (request, response) => {
    accepted = request.body;
    response.status(204).end();
  });
  fixture.use(errorHandler);
  const server = fixture.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/register`;
  try {
    const invalidPassword = "PRIVATE_INVALID_PASSWORD";
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...valid, email: "invalid", password: invalidPassword }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.ok(body.error.fields.email.length);
    assert.ok(body.error.fields.password.length);
    assert.ok(!JSON.stringify(body).includes(invalidPassword));
    assert.equal(accepted, undefined);
    assert.equal(logger.mock.calls.length, 0);

    const success = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...valid, firstName: " Anirban ", email: " Person@Example.org " }),
    });
    assert.equal(success.status, 204);
    assert.equal(accepted.email, "person@example.org");
    assert.equal(accepted.firstName, "Anirban");
    assert.equal(accepted.password, valid.password);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
