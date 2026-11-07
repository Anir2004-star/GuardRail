import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuthOrigin } from "../middleware/require-auth-origin.js";
import { createGoogleChallenge, completeGoogleSignIn } from "../services/google-auth.service.js";
import { setRefreshCookie } from "../auth/refresh-cookie.js";

export const googleAuthRouter = Router();
const limiter = (limit: number) => rateLimit({
  windowMs: 15 * 60 * 1000, limit, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_request, response) => { response.status(429).json({ error: { code: "TOO_MANY_REQUESTS", message: "Too many Google sign-in attempts. Please try again later." } }); },
});
googleAuthRouter.post("/challenge", requireAuthOrigin, limiter(30), async (request, response) => {
  response.status(200).json(await createGoogleChallenge(request.body, response));
});
googleAuthRouter.post("/complete", requireAuthOrigin, limiter(10), async (request, response) => {
  const result = await completeGoogleSignIn(request.body, request, response);
  setRefreshCookie(response, result.refresh.token.value, result.refresh.expiresAt);
  response.status(200).json(result.body);
});
