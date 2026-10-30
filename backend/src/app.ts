import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { healthRouter } from "./routes/health.routes.js";
import { readyRouter } from "./routes/ready.routes.js";
import { authRouter } from "./routes/auth.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  credentials: false,
  origin(requestOrigin, callback) {
    if (!requestOrigin || requestOrigin === env.FRONTEND_ORIGIN) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
app.use(express.json({ limit: "100kb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.use("/health", healthRouter);
app.use("/ready", readyRouter);
app.use("/api/v1/auth", authRouter);

app.use(notFound);
app.use(errorHandler);
