import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuthOrigin } from "../middleware/require-auth-origin.js";
import { confirmEmailVerification, requestEmailVerification } from "../services/email-verification.service.js";

export const emailVerificationRouter = Router();
const limit = (count: number) => rateLimit({
  windowMs: 15 * 60 * 1000, limit: count, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_request, response) => { response.status(429).json({ error: { code: "TOO_MANY_REQUESTS", message: "Too many email verification attempts. Please try again later." } }); },
});
emailVerificationRouter.post("/resend-verification", requireAuthOrigin, limit(10), (request, response) => {
  requestEmailVerification(request.body);
  response.status(202).json({ message: "If an account needs verification, a verification link will be sent." });
});
emailVerificationRouter.post("/verify-email", requireAuthOrigin, limit(20), async (request, response) => {
  await confirmEmailVerification(request.body);
  response.status(204).end();
});
