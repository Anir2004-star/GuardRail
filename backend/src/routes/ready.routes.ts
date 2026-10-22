import { Router } from "express";
import { prisma } from "../config/database.js";

export const readyRouter = Router();

readyRouter.get("/", async (_request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.status(200).json({ status: "ready", database: "connected" });
  } catch {
    response.status(503).json({ status: "not_ready", database: "unavailable" });
  }
});
