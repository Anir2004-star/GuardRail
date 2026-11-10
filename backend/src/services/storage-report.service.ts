import { prisma } from "../config/database.js";
import { invalidPairingCredential } from "../auth/device-pairing.js";
import { parseStorageReport } from "../validation/storage-report.validation.js";
import { lockDevice } from "./device-pairing.service.js";
import { DeviceError } from "./device.service.js";

export async function acceptStorageReport(hash: string, input: unknown) {
  const hint = await prisma.deviceCredential.findUnique({ where: { tokenHash: hash }, select: { id: true, deviceId: true, device: { select: { userId: true } } } });
  if (!hint) throw invalidPairingCredential();
  return prisma.$transaction(async (tx) => {
    // Shared owner/device locks make a concurrent disconnect or replacement final.
    await lockDevice(tx, hint.device.userId, hint.deviceId);
    const credential = await tx.deviceCredential.findUnique({ where: { id: hint.id } });
    if (!credential || credential.revokedAt || credential.expiresAt <= new Date()) throw invalidPairingCredential();
    const data = parseStorageReport(input);
    const previous = await tx.deviceStorageReport.findUnique({ where: { deviceId: hint.deviceId } });
    if (previous?.credentialId === credential.id) {
      if (previous.reportId === data.reportId) {
        if (previous.collectedAt.getTime() !== data.collectedAt.getTime() || JSON.stringify(previous.volumes) !== JSON.stringify(data.volumes)) {
          // JSONB key order is not stable: compare the validated canonical volume fields.
          const old = previous.volumes as { id: string; totalBytes: number; freeBytes: number }[];
          if (previous.collectedAt.getTime() !== data.collectedAt.getTime() || !Array.isArray(old) || old.length !== data.volumes.length || old.some((volume, index) => volume.id !== data.volumes[index]?.id || volume.totalBytes !== data.volumes[index]?.totalBytes || volume.freeBytes !== data.volumes[index]?.freeBytes)) {
            throw new DeviceError(409, "REPORT_CONFLICT", "This report ID was already used for different capacity data.");
          }
        }
        return { reportId: previous.reportId, receivedAt: previous.receivedAt };
      }
      if (data.collectedAt <= previous.collectedAt) throw new DeviceError(409, "STALE_REPORT", "A newer capacity report is already stored.");
    }
    const report = await tx.deviceStorageReport.upsert({ where: { deviceId: hint.deviceId },
      create: { deviceId: hint.deviceId, credentialId: credential.id, ...data },
      update: { credentialId: credential.id, ...data, receivedAt: new Date() },
    });
    return { reportId: report.reportId, receivedAt: report.receivedAt };
  }, { maxWait: 5000, timeout: 10000 });
}
