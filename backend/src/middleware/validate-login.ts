import type { RequestHandler } from "express";
import { parseLoginInput } from "../validation/auth.validation.js";

export const validateLogin: RequestHandler = (request, response, next) => {
  response.set("Cache-Control", "no-store");
  try {
    request.body = parseLoginInput(request.body);
    next();
  } catch (error) {
    next(error);
  }
};
