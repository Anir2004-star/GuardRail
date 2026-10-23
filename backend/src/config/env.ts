import "dotenv/config";

export type NodeEnvironment = "development" | "test" | "production";

export type Environment = Readonly<{
  PORT: number;
  NODE_ENV: NodeEnvironment;
  FRONTEND_ORIGIN: string;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_SESSION_TTL_SECONDS: number;
  BCRYPT_ROUNDS: number;
}>;

const supportedEnvironments = new Set<NodeEnvironment>(["development", "test", "production"]);

function parsePort(value: string | undefined): number {
  const candidate = value ?? "4000";
  if (!/^\d+$/.test(candidate)) {
    throw new Error("Invalid environment configuration: PORT must be an integer between 1 and 65535.");
  }

  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid environment configuration: PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const candidate = value ?? "development";
  if (!supportedEnvironments.has(candidate as NodeEnvironment)) {
    throw new Error("Invalid environment configuration: NODE_ENV must be development, test, or production.");
  }

  return candidate as NodeEnvironment;
}

function parseFrontendOrigin(value: string | undefined): string {
  const candidate = value ?? "http://localhost:3000";

  try {
    const url = new URL(candidate);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const isOriginOnly = url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
    if (!isHttp || !isOriginOnly) throw new Error("not an HTTP origin");
    return url.origin;
  } catch {
    throw new Error("Invalid environment configuration: FRONTEND_ORIGIN must be a valid HTTP or HTTPS origin.");
  }
}

function parseDatabaseUrl(value: string | undefined): string {
  try {
    if (!value) throw new Error("missing");
    const url = new URL(value);
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
      throw new Error("invalid");
    }
    return value;
  } catch {
    // Never include the supplied value: it may contain credentials.
    throw new Error("Invalid environment configuration: DATABASE_URL must be a PostgreSQL URL with a host and database name.");
  }
}

function parseAccessSecret(value: string | undefined): string {
  // Require the hex encoding produced by crypto.randomBytes(32) or longer.
  // Format checks cannot prove randomness; always use the documented generator.
  if (!value || !/^[a-fA-F0-9]{64,256}$/.test(value) || value.length % 2 !== 0 || new Set(value.toLowerCase()).size < 8) {
    throw new Error("Invalid environment configuration: JWT_ACCESS_SECRET must be a securely generated hex secret of 32 to 128 bytes. Generate it using node:crypto randomBytes(32). Never use a placeholder or repeated characters.");
  }
  return value;
}

function parseTokenIdentifier(value: string | undefined, fallback: string, name: string): string {
  const candidate = value ?? fallback;
  if (!/^[\x21-\x7E]{1,200}$/.test(candidate)) {
    throw new Error(`Invalid environment configuration: ${name} must contain 1 to 200 printable ASCII characters without spaces.`);
  }
  return candidate;
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const candidate = value ?? String(fallback);
  if (!/^\d+$/.test(candidate) || !Number.isSafeInteger(Number(candidate)) || Number(candidate) < min || Number(candidate) > max) {
    throw new Error(`Invalid environment configuration: ${name} must be an integer between ${min} and ${max}.`);
  }
  return Number(candidate);
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return Object.freeze({
    PORT: parsePort(source.PORT),
    NODE_ENV: parseNodeEnvironment(source.NODE_ENV),
    FRONTEND_ORIGIN: parseFrontendOrigin(source.FRONTEND_ORIGIN),
    DATABASE_URL: parseDatabaseUrl(source.DATABASE_URL),
    JWT_ACCESS_SECRET: parseAccessSecret(source.JWT_ACCESS_SECRET),
    JWT_ISSUER: parseTokenIdentifier(source.JWT_ISSUER, "guardrail-api", "JWT_ISSUER"),
    JWT_AUDIENCE: parseTokenIdentifier(source.JWT_AUDIENCE, "guardrail-web", "JWT_AUDIENCE"),
    ACCESS_TOKEN_TTL_SECONDS: parseBoundedInteger(source.ACCESS_TOKEN_TTL_SECONDS, 900, 60, 3_600, "ACCESS_TOKEN_TTL_SECONDS"),
    REFRESH_SESSION_TTL_SECONDS: parseBoundedInteger(source.REFRESH_SESSION_TTL_SECONDS, 604_800, 3_600, 2_592_000, "REFRESH_SESSION_TTL_SECONDS"),
    BCRYPT_ROUNDS: parseBoundedInteger(source.BCRYPT_ROUNDS, 12, 10, 14, "BCRYPT_ROUNDS"),
  });
}

export const env = loadEnvironment();
