import type { ErrorRequestHandler } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { InputValidationError } from "../validation/auth.validation.js";

type HttpParserError = Error & {
  status?: number;
  type?: string;
  body?: unknown;
};

function isParserError(error: unknown): error is HttpParserError {
  return error instanceof Error;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isEmailConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (error.meta?.modelName !== undefined && error.meta.modelName !== "User") return false;

  // Prisma's engine exposes meta.target; Prisma 7's pg adapter can instead
  // expose the constraint through DriverAdapterError.cause.
  const cause = record(record(error.meta?.driverAdapterError)?.cause);
  const fields = Array.isArray(error.meta?.target)
    ? error.meta.target
    : cause?.kind === "UniqueConstraintViolation" ? record(cause.constraint)?.fields : undefined;
  if (Array.isArray(fields) && fields.length === 1 && fields[0] === "email") return true;
  // Some pg error formats identify the unique index rather than column names.
  return cause?.kind === "UniqueConstraintViolation" &&
    record(cause.constraint)?.index === "users_email_key";
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  // Express recognizes error middleware by its four-argument signature.
  void _next;
  if (error instanceof InputValidationError) {
    response.set("Cache-Control", "no-store").status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: error.message,
        fields: error.fields,
      },
    });
    return;
  }

  if (isParserError(error) && (error.type === "entity.parse.failed" || error.status === 400 && "body" in error)) {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body contains malformed JSON",
      },
    });
    return;
  }

  if (isParserError(error) && (error.type === "entity.too.large" || error.status === 413)) {
    response.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body is too large",
      },
    });
    return;
  }

  if (isEmailConflict(error)) {
    response.set("Cache-Control", "no-store").status(409).json({
      error: {
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists.",
      },
    });
    return;
  }

  // Raw errors can contain query arguments, database URLs or password hashes.
  console.error("Unexpected request error");
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};
