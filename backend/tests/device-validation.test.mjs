import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
const { parseDeviceRegistration, parseDeviceRename, parseDeviceId, requireEmptyDeviceQuery } = await import("../dist/validation/device.validation.js");
const valid = { requestId: randomUUID(), name: " My laptop ", type: "Laptop" };

test("device registration trims metadata, supports each category and keeps optional fields nullable", () => {
  for (const type of ["Laptop", "Smartphone", "Tablet"]) {
    const data = parseDeviceRegistration({ ...valid, type, brand: " Apple ", model: " ", os: " macOS " });
    assert.equal(data.name, "My laptop"); assert.equal(data.type, type);
    assert.equal(data.brand, "Apple"); assert.equal(data.model, null); assert.equal(data.os, "macOS");
  }
  assert.equal(parseDeviceRegistration(valid).brand, null);
  assert.equal(parseDeviceRename({ name: " मेरा लैपटॉप " }).name, "मेरा लैपटॉप");
});
test("names, metadata lengths, types and request identifiers are validated without coercion", () => {
  for (const change of [{ name: " " }, { name: "x".repeat(61) }, { name: "bad\0name" }, { brand: "x".repeat(81) }, { model: 12 }, { os: null }, { type: "Server" }, { requestId: "invalid" }]) {
    assert.throws(() => parseDeviceRegistration({ ...valid, ...change }), (error) => error.name === "InputValidationError");
  }
  assert.equal(parseDeviceRegistration({ ...valid, name: "x".repeat(60), brand: "x".repeat(80) }).name.length, 60);
});
test("ownership, connection and storage fields are not accepted or echoed", () => {
  for (const extra of [{ userId: "PRIVATE_OWNER" }, { paired: true }, { storage: { totalGb: 512 } }, { status: "connected" }, { PRIVATE_PASSWORD: "private-value" }]) {
    assert.throws(() => parseDeviceRegistration({ ...valid, ...extra }), (error) => {
      assert.equal(error.name, "InputValidationError");
      assert.ok(!JSON.stringify(error).includes("PRIVATE_"));
      assert.ok(!JSON.stringify(error).includes("private-value"));
      return true;
    });
  }
  assert.throws(() => parseDeviceRename({ name: "New name", type: "Tablet" }));
});
test("malformed identifiers, query filters and unsupported bodies fail safely", () => {
  const id = randomUUID(); assert.equal(parseDeviceId(id), id);
  assert.throws(() => parseDeviceId("PRIVATE_INVALID_ID"), (error) => !JSON.stringify(error).includes("PRIVATE_INVALID_ID"));
  requireEmptyDeviceQuery({});
  assert.throws(() => requireEmptyDeviceQuery({ userId: "PRIVATE_OWNER" }), (error) => !JSON.stringify(error).includes("PRIVATE_OWNER"));
  for (const body of [null, undefined, [], "PRIVATE_PASSWORD", 10]) assert.throws(() => parseDeviceRegistration(body));
});
