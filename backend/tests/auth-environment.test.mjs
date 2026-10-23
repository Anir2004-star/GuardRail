import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const secret = randomBytes(32).toString("hex");
process.env.JWT_ACCESS_SECRET = secret;
// Importing configuration must never require the development database.
process.env.DATABASE_URL = "postgresql://test:unused@localhost:1/guardrail_test";
const { loadEnvironment } = await import("../dist/config/env.js");
const base = { DATABASE_URL: process.env.DATABASE_URL, JWT_ACCESS_SECRET: secret };

test("auth environment defaults and explicit values are parsed", () => {
  const settings = loadEnvironment(base);
  assert.equal(settings.JWT_ACCESS_SECRET, secret);
  assert.equal(settings.JWT_ISSUER, "guardrail-api");
  assert.equal(settings.JWT_AUDIENCE, "guardrail-web");
  assert.equal(settings.ACCESS_TOKEN_TTL_SECONDS, 900);
  assert.equal(settings.REFRESH_SESSION_TTL_SECONDS, 604800);
  assert.equal(settings.BCRYPT_ROUNDS, 12);
  assert.ok(Object.isFrozen(settings));
  const custom = loadEnvironment({ ...base, ACCESS_TOKEN_TTL_SECONDS: "600", REFRESH_SESSION_TTL_SECONDS: "7200", BCRYPT_ROUNDS: "10", JWT_ISSUER: "custom-api", JWT_AUDIENCE: "custom-web" });
  assert.equal(custom.ACCESS_TOKEN_TTL_SECONDS, 600);
  assert.equal(custom.REFRESH_SESSION_TTL_SECONDS, 7200);
  assert.equal(custom.BCRYPT_ROUNDS, 10);
  assert.equal(custom.JWT_ISSUER, "custom-api");
  assert.equal(custom.JWT_AUDIENCE, "custom-web");
});

test("missing, placeholder, short and repetitive signing secrets fail without exposing values", () => {
  for (const JWT_ACCESS_SECRET of [undefined, "", "YOUR_GENERATED_SECRET", "a".repeat(64), "1234".repeat(16), randomBytes(16).toString("hex"), secret + "0", secret + " "]) {
    assert.throws(() => loadEnvironment({ ...base, JWT_ACCESS_SECRET }), (error) => {
      assert.match(error.message, /JWT_ACCESS_SECRET/);
      if (JWT_ACCESS_SECRET) assert.ok(!error.message.includes(JWT_ACCESS_SECRET));
      return true;
    });
  }
});

test("token durations and bcrypt rounds are bounded integers", () => {
  const cases = {
    ACCESS_TOKEN_TTL_SECONDS: ["", "0", "59", "3601", "1.5", "NaN", "900 "],
    REFRESH_SESSION_TTL_SECONDS: ["", "3599", "2592001", "-1", "1e5"],
    BCRYPT_ROUNDS: ["", "9", "15", "12.5", "twelve"],
  };
  for (const [name, values] of Object.entries(cases)) {
    for (const value of values) {
      assert.throws(() => loadEnvironment({ ...base, [name]: value }), new RegExp(name));
    }
  }
});

test("issuer and audience reject empty, whitespace and control characters", () => {
  for (const name of ["JWT_ISSUER", "JWT_AUDIENCE"]) {
    for (const value of ["", " ", "guardrail api", "api\n", "x".repeat(201)]) {
      assert.throws(() => loadEnvironment({ ...base, [name]: value }), new RegExp(name));
    }
  }
});
