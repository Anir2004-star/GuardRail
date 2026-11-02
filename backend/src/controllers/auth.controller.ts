import type { RequestHandler } from "express";
import { createLoginSession, registerUser } from "../services/auth.service.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "../auth/refresh-cookie.js";
import { rotateRefreshSession } from "../services/refresh-session.service.js";
import { InvalidRefreshTokenError } from "../errors/auth.errors.js";

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

export const refreshController: RequestHandler = async (request, response) => {
  try {
    const result = await rotateRefreshSession(readRefreshCookie(request));
    if (result.refresh.expiresAt.getTime() <= Date.now()) throw new InvalidRefreshTokenError();
    setRefreshCookie(response, result.refresh.token.value, result.refresh.expiresAt);
    response.status(200).json(result.body);
  } catch (error) {
    if (error instanceof InvalidRefreshTokenError) clearRefreshCookie(response);
    // Transient/internal failures do not discard the browser's current cookie.
    throw error;
  }
};
