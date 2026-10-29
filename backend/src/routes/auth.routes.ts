import { Router } from "express";
import { requireAuthOrigin } from "../middleware/require-auth-origin.js";
import { registrationRateLimit } from "../middleware/auth-rate-limit.js";
import { validateRegistration } from "../middleware/validate-registration.js";
import { registerUser } from "../services/auth.service.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  requireAuthOrigin,
  registrationRateLimit,
  validateRegistration,
  async (request, response) => {
    const user = await registerUser(request.body);

    response.status(201).json({ user });
  }
);