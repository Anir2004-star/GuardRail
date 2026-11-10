import assert from "node:assert/strict";
import { test } from "node:test";
import { claimSchema, parsePairing, emptyPairingSchema, approvalSchema } from "../dist/validation/pairing.validation.js";

test("pairing claims normalize codes and bound self-reported metadata", () => {
  assert.deepEqual(parsePairing(claimSchema, { code: "abcd-efgh-jklm", appName: " Guardrail ", platform: " Windows " }), { code: "ABCDEFGHJKLM", appName: "Guardrail", platform: "Windows" });
  for (const input of [{ code: "AAAA", appName: "App", platform: "Windows" }, { code: "ABCDEFGHJKLM", appName: "x".repeat(81), platform: "Windows" }, { code: "ABCDEFGHJKLM", appName: "bad\0name", platform: "Windows" }, { code: "ABCDEFGHJKLM", appName: "App", platform: "Windows", userId: "PRIVATE_OWNER" }]) {
    assert.throws(() => parsePairing(claimSchema, input), (error) => !JSON.stringify(error).includes("PRIVATE_OWNER") && error.fields.body.length > 0);
  }
});
test("pairing decisions reject unsupported fields without echoing credentials", () => {
  assert.deepEqual(parsePairing(emptyPairingSchema, {}), {});
  for (const schema of [emptyPairingSchema, approvalSchema]) assert.throws(() => parsePairing(schema, { claimToken: "PRIVATE_SECRET" }), (error) => !JSON.stringify(error).includes("PRIVATE_SECRET"));
});
