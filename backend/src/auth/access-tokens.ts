import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { InvalidAccessTokenError } from "../errors/auth.errors.js";

// The environment secret is hex-encoded random bytes. Never export or log it.
const signingKey = Buffer.from(env.JWT_ACCESS_SECRET, "hex");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccessTokenResult = Readonly<{
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}>;

export type VerifiedAccessToken = Readonly<{
  userId: string;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
}>;

export async function createAccessToken(userId: string): Promise<AccessTokenResult> {
  if (typeof userId !== "string" || !uuidPattern.test(userId)) {
    throw new Error("Access token subject must be a user UUID.");
  }
  const issuedAt = Math.floor(Date.now() / 1_000);
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + env.ACCESS_TOKEN_TTL_SECONDS)
    .setJti(randomUUID())
    .sign(signingKey);

  return Object.freeze({ accessToken, tokenType: "Bearer", expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
}

export async function verifyAccessToken(token: unknown): Promise<VerifiedAccessToken> {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > 4_096) {
      throw new InvalidAccessTokenError();
    }
    const { payload } = await jwtVerify(token, signingKey, {
      algorithms: ["HS256"],
      typ: "at+jwt",
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      requiredClaims: ["sub", "iss", "aud", "iat", "exp", "jti"],
      maxTokenAge: env.ACCESS_TOKEN_TTL_SECONDS,
      clockTolerance: 0,
    });
    if (
      typeof payload.sub !== "string" || !uuidPattern.test(payload.sub) ||
      typeof payload.jti !== "string" || !uuidPattern.test(payload.jti) ||
      typeof payload.iat !== "number" || !Number.isSafeInteger(payload.iat) ||
      typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) ||
      payload.exp <= payload.iat || payload.exp - payload.iat > env.ACCESS_TOKEN_TTL_SECONDS
    ) {
      throw new InvalidAccessTokenError();
    }
    return Object.freeze({ userId: payload.sub, issuedAt: payload.iat, expiresAt: payload.exp, tokenId: payload.jti });
  } catch {
    // No raw JWT, claims, key, or library details in errors or logs.
    throw new InvalidAccessTokenError();
  }
}
