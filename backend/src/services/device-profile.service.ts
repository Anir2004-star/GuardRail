import { prisma } from "../config/database.js";
import { invalidPairingCredential } from "../auth/device-pairing.js";
import { parseDetectedDeviceDetails } from "../validation/device.validation.js";
import { lockDevice } from "./device-pairing.service.js";

export async function syncDeviceDetails(hash: string, input: unknown) {
  const hint = await prisma.deviceCredential.findUnique({ where: { tokenHash: hash }, select: { id: true, deviceId: true, device: { select: { userId: true } } } });
  if (!hint) throw invalidPairingCredential();
  return prisma.$transaction(async (tx) => {
    await lockDevice(tx, hint.device.userId, hint.deviceId);
    const credential = await tx.deviceCredential.findUnique({ where: { id: hint.id } });
    if (!credential || credential.revokedAt || credential.expiresAt <= new Date()) throw invalidPairingCredential();
    const details = parseDetectedDeviceDetails(input);
    const existing = await tx.device.findUniqueOrThrow({ where: { id: hint.deviceId }, select: { brand: true, model: true, os: true } });
    // Omitted/unavailable fields preserve saved values; retries do not alter updatedAt.
    const changes: Partial<Record<"brand" | "model" | "os", string>> = {};
    for (const key of ["brand", "model", "os"] as const) {
      const value = details[key];
      if (value !== undefined && existing[key] !== value) changes[key] = value;
    }
    if (Object.keys(changes).length) await tx.device.update({ where: { id: hint.deviceId }, data: changes });
    return { deviceId: hint.deviceId, synced: true };
  }, { maxWait: 5000, timeout: 10000 });
}
