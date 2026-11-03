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

// Independent quota/store: login attempts do not consume signup's allowance.
// Count successful and failed requests to bound expensive password comparisons.
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.set("Cache-Control", "no-store").status(429).json({
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Too many login attempts. Please try again later.",
      },
    });
  },
});

export const refreshRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.set("Cache-Control", "no-store").status(429).json({
      error: { code: "TOO_MANY_REQUESTS", message: "Too many session refresh attempts. Please try again later." },
    });
  },
});

export const logoutRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.set("Cache-Control", "no-store").status(429).json({
      error: { code: "TOO_MANY_REQUESTS", message: "Too many logout attempts. Please try again later." },
    });
  },
});
