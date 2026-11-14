import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth, type AuthenticatedHandler } from "../middleware/require-auth.js";
import { requireAuthOrigin } from "../middleware/require-auth-origin.js";
import { getDevice, listDevices, registerDevice, removeDevice, renameDevice } from "../services/device.service.js";
import { requireEmptyDeviceQuery } from "../validation/device.validation.js";
import { decideDevicePairing, disconnectDevice, getDevicePairing, startDevicePairing } from "../services/device-pairing.service.js";
import { getFolderScan } from "../services/folder-scan.service.js";

export const deviceRouter = Router();
deviceRouter.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_request, response) => { response.status(429).json({ error: { code: "TOO_MANY_REQUESTS", message: "Too many device requests. Please try again later." } }); },
});
const readLimit = limiter(300); const writeLimit = limiter(60);
const list: AuthenticatedHandler = async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  response.json({ devices: await listDevices(response.locals.authUser.id) });
};
const get: AuthenticatedHandler = async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  response.json({ device: await getDevice(response.locals.authUser.id, request.params.id) });
};
const create: AuthenticatedHandler = async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  response.status(201).json({ device: await registerDevice(response.locals.authUser.id, request.body) });
};
const rename: AuthenticatedHandler = async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  response.json({ device: await renameDevice(response.locals.authUser.id, request.params.id, request.body) });
};
const remove: AuthenticatedHandler = async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  await removeDevice(response.locals.authUser.id, request.params.id);
  response.status(204).end();
};
deviceRouter.get("/", requireAuth, readLimit, list);
deviceRouter.get("/:id", requireAuth, readLimit, get);
deviceRouter.get("/:id/folder-scan", requireAuth, readLimit, async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  response.json(await getFolderScan(response.locals.authUser.id, request.params.id));
});
deviceRouter.post("/", requireAuthOrigin, writeLimit, requireAuth, create);
deviceRouter.patch("/:id", requireAuthOrigin, writeLimit, requireAuth, rename);
deviceRouter.delete("/:id", requireAuthOrigin, writeLimit, requireAuth, remove);
deviceRouter.get("/:id/pairing", requireAuth, readLimit, async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  response.json(await getDevicePairing(response.locals.authUser.id, request.params.id));
});
deviceRouter.post("/:id/pairing", requireAuthOrigin, writeLimit, requireAuth, async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  response.status(201).json(await startDevicePairing(response.locals.authUser.id, request.params.id, request.body));
});
for (const decision of ["approve", "reject", "cancel"] as const) {
  deviceRouter.post(`/:id/pairing/:pairingId/${decision}`, requireAuthOrigin, writeLimit, requireAuth, async (request, response) => {
    requireEmptyDeviceQuery(request.query);
    response.json(await decideDevicePairing(response.locals.authUser.id, request.params.id, request.params.pairingId, decision, request.body));
  });
}
deviceRouter.post("/:id/disconnect", requireAuthOrigin, writeLimit, requireAuth, async (request, response) => {
  requireEmptyDeviceQuery(request.query);
  await disconnectDevice(response.locals.authUser.id, request.params.id, request.body);
  response.status(204).end();
});
