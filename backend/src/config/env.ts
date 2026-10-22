import "dotenv/config";

export type NodeEnvironment = "development" | "test" | "production";

export type Environment = Readonly<{
  PORT: number;
  NODE_ENV: NodeEnvironment;
  FRONTEND_ORIGIN: string;
  DATABASE_URL: string;
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

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return Object.freeze({
    PORT: parsePort(source.PORT),
    NODE_ENV: parseNodeEnvironment(source.NODE_ENV),
    FRONTEND_ORIGIN: parseFrontendOrigin(source.FRONTEND_ORIGIN),
    DATABASE_URL: parseDatabaseUrl(source.DATABASE_URL),
  });
}

export const env = loadEnvironment();
