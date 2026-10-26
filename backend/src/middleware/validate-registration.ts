import type { RequestHandler } from "express";
import { parseRegistrationInput } from "../validation/auth.validation.js";

export const validateRegistration: RequestHandler = (request, response, next) => {
  response.set("Cache-Control", "no-store");
  try {
    request.body = parseRegistrationInput(request.body);
    next();
  } catch (error) {
    next(error);
  }
};
