import { Router } from "express";
import { registerController } from "../controllers/auth.controller.js";
import { requireAuthOrigin } from "../middleware/require-auth-origin.js";
import { registrationRateLimit } from "../middleware/auth-rate-limit.js";
import { validateRegistration } from "../middleware/validate-registration.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  requireAuthOrigin,
  registrationRateLimit,
  validateRegistration,
  registerController
);