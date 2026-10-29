import type { RequestHandler } from "express";
import { env } from "../config/env.js";

export const requireAuthOrigin: RequestHandler = (
  request,
  response,
  next
) => {
  response.set("Cache-Control", "no-store");

  if (request.get("Origin") !== env.FRONTEND_ORIGIN) {
    response.status(403).json({
      error: {
        code: "ORIGIN_NOT_ALLOWED",
        message: "Request origin is not allowed.",
      },
    });
    return;
  }

  next();
};