import type { CookieOptions, Response } from "express";
import { env, type NodeEnvironment } from "../config/env.js";
import { hashRefreshToken } from "./refresh-tokens.js";

export const REFRESH_COOKIE_NAME = "guardrail_refresh";

export function refreshCookieOptions(environment: NodeEnvironment = env.NODE_ENV): CookieOptions {
  return {
    httpOnly: true,
    secure: environment === "production",
    sameSite: "lax",
    path: "/api/v1/auth",
    // Omitting Domain makes the cookie host-only.
  };
}

export function setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
  // Validate before touching response headers; never include secret input in errors.
  hashRefreshToken(token);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error("Refresh cookie requires a future session expiry");
  }
  response.set("Cache-Control", "no-store");
  response.cookie(REFRESH_COOKIE_NAME, token, { ...refreshCookieOptions(), expires: expiresAt });
}

export function clearRefreshCookie(response: Response): void {
  response.set("Cache-Control", "no-store");
  // Express supplies an expired date; omit expires/maxAge from deletion options.
  response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}
