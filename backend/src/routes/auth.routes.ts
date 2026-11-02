import { Router } from "express";
import { loginController, registerController } from "../controllers/auth.controller.js";
import { requireAuthOrigin } from "../middleware/require-auth-origin.js";
import { loginRateLimit, registrationRateLimit } from "../middleware/auth-rate-limit.js";
import { validateRegistration } from "../middleware/validate-registration.js";
import { validateLogin } from "../middleware/validate-login.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  requireAuthOrigin,
  registrationRateLimit,
  validateRegistration,
  registerController
);

authRouter.post(
  "/login",
  requireAuthOrigin,
  loginRateLimit,
  validateLogin,
  loginController
);
