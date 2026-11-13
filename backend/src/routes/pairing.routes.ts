import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { readPairingCredential } from "../auth/device-pairing.js";
import { DeviceError } from "../services/device.service.js";
import { claimDevicePairing, disconnectCompanion, exchangeDevicePairing, getCompanionDevice, getCompanionPairing } from "../services/device-pairing.service.js";
import { requireEmptyDeviceQuery } from "../validation/device.validation.js";
import { acceptStorageReport } from "../services/storage-report.service.js";
import { syncDeviceDetails } from "../services/device-profile.service.js";

export const pairingRouter = Router();
export const companionRouter = Router();
const guard: RequestHandler = (request, response, next) => {
  response.set("Cache-Control", "no-store");
  requireEmptyDeviceQuery(request.query);
  // Local development uses HTTP. Production must terminate trusted TLS here.
  if (env.NODE_ENV === "production" && !request.secure) throw new DeviceError(403, "HTTPS_REQUIRED", "Use a secure connection for device pairing.");
  if (request.headers.origin && request.headers.origin !== env.FRONTEND_ORIGIN) throw new DeviceError(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed.");
  next();
};
const limit = (count: number) => rateLimit({ windowMs: 900000, limit: count, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_request, response) => { response.status(429).json({ error: { code: "TOO_MANY_REQUESTS", message: "Too many pairing requests. Try again later." } }); },
});
pairingRouter.use(guard); companionRouter.use(guard);
pairingRouter.post("/claim", limit(20), async (request, response) => { response.status(201).json(await claimDevicePairing(request.body)); });
pairingRouter.get("/status", limit(300), async (request, response) => { response.json(await getCompanionPairing(readPairingCredential(request, "claim"))); });
pairingRouter.post("/exchange", limit(60), async (request, response) => { response.status(201).json(await exchangeDevicePairing(readPairingCredential(request, "claim"), request.body)); });
companionRouter.get("/me", limit(300), async (request, response) => { response.json(await getCompanionDevice(readPairingCredential(request, "device"))); });
companionRouter.post("/device-details", limit(60), async (request, response) => {
  response.json(await syncDeviceDetails(readPairingCredential(request, "device"), request.body));
});
companionRouter.post("/storage-reports", limit(60), async (request, response) => {
  response.json(await acceptStorageReport(readPairingCredential(request, "device"), request.body));
});
companionRouter.post("/disconnect", limit(60), async (request, response) => {
  await disconnectCompanion(readPairingCredential(request, "device"), request.body);
  response.status(204).end();
});
