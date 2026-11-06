import { Router } from "express";
import { currentUserController, forgotPasswordController, loginController, logoutController, refreshController, registerController, resetPasswordController } from "../controllers/auth.controller.js";
import { requireAuthOrigin } from "../middleware/require-auth-origin.js";
import { forgotPasswordRateLimit, loginRateLimit, logoutRateLimit, refreshRateLimit, registrationRateLimit, resetPasswordRateLimit } from "../middleware/auth-rate-limit.js";
import { validateRegistration } from "../middleware/validate-registration.js";
import { validateLogin } from "../middleware/validate-login.js";
import { requireAuth } from "../middleware/require-auth.js";
import { validateForgotPassword, validateResetPassword } from "../middleware/validate-password-reset.js";

export const authRouter = Router();

authRouter.get("/me", requireAuth, currentUserController);

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

authRouter.post("/refresh", requireAuthOrigin, refreshRateLimit, refreshController);
authRouter.post("/logout", requireAuthOrigin, logoutRateLimit, logoutController);
authRouter.post("/forgot-password", requireAuthOrigin, forgotPasswordRateLimit, validateForgotPassword, forgotPasswordController);
authRouter.post("/reset-password", requireAuthOrigin, resetPasswordRateLimit, validateResetPassword, resetPasswordController);
