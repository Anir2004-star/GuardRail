import type { RequestHandler } from "express";
import { createLoginSession, registerUser } from "../services/auth.service.js";
import { setRefreshCookie } from "../auth/refresh-cookie.js";

export const registerController: RequestHandler = async (
  request,
  response
) => {
  const user = await registerUser(request.body);

  response.status(201).json({ user });
};

// The public route applies origin, rate-limit and validation middleware first.
export const loginController: RequestHandler = async (request, response) => {
  const result = await createLoginSession(request.body);
  setRefreshCookie(response, result.refresh.token.value, result.refresh.expiresAt);
  response.status(200).json(result.body);
};
