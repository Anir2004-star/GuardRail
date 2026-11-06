import type { RequestHandler } from "express";
import { parseForgotPasswordInput, parseResetPasswordInput } from "../validation/auth.validation.js";

function validate(parser: (input: unknown) => unknown): RequestHandler {
  return (request, response, next) => {
    response.set("Cache-Control", "no-store");
    try { request.body = parser(request.body); next(); } catch (error) { next(error); }
  };
}
export const validateForgotPassword = validate(parseForgotPasswordInput);
export const validateResetPassword = validate(parseResetPasswordInput);
