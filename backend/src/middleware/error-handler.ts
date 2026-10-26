import type { ErrorRequestHandler } from "express";
import { InputValidationError } from "../validation/auth.validation.js";

type HttpParserError = Error & {
  status?: number;
  type?: string;
  body?: unknown;
};

function isParserError(error: unknown): error is HttpParserError {
  return error instanceof Error;
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
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

  console.error("Unexpected request error", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};
