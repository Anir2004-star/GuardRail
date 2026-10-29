import { rateLimit } from "express-rate-limit";

export const registrationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.set("Cache-Control", "no-store").status(429).json({
      error: {
        code: "TOO_MANY_REQUESTS",
        message:
          "Too many registration attempts. Please try again later.",
      },
    });
  },
});