import { prisma } from "../config/database.js";
import { invalidPairingCredential } from "../auth/device-pairing.js";
import { DeviceError } from "./device.service.js";
import { lockDevice } from "./device-pairing.service.js";
import { folderScanSchema, parseFolderScan } from "../validation/folder-scan.validation.js";
import { parseDeviceId } from "../validation/device.validation.js";

export async function acceptFolderScan(hash: string, input: unknown) {
  const hint = await prisma.deviceCredential.findUnique({ where: { tokenHash: hash }, select: { id: true, deviceId: true, device: { select: { userId: true } } } });
  if (!hint) throw invalidPairingCredential();
  return prisma.$transaction(async (tx) => {
    await lockDevice(tx, hint.device.userId, hint.deviceId);
    const credential = await tx.deviceCredential.findUnique({ where: { id: hint.id } });
    if (!credential || credential.revokedAt || credential.expiresAt <= new Date()) throw invalidPairingCredential();
    const report = parseFolderScan(input);
    const previous = await tx.deviceFolderScan.findUnique({ where: { deviceId: hint.deviceId } });
    if (previous?.credentialId === hint.id) {
      if (previous.scanId === report.scanId) {
        const old = folderScanSchema.safeParse(previous.report);
        if (!old.success || JSON.stringify(old.data) !== JSON.stringify(report)) throw new DeviceError(409, "SCAN_CONFLICT", "This scan ID already saved different results.");
        return { scanId: report.scanId, receivedAt: previous.receivedAt };
      }
      if (new Date(report.finishedAt) <= previous.finishedAt) throw new DeviceError(409, "STALE_SCAN", "A newer scan is already stored.");
    }
    const scan = await tx.deviceFolderScan.upsert({ where: { deviceId: hint.deviceId },
      create: { deviceId: hint.deviceId, credentialId: hint.id, scanId: report.scanId, finishedAt: new Date(report.finishedAt), report },
      update: { credentialId: hint.id, scanId: report.scanId, finishedAt: new Date(report.finishedAt), receivedAt: new Date(), report },
    });
    return { scanId: scan.scanId, receivedAt: scan.receivedAt };
  }, { maxWait: 5000, timeout: 10000 });
}
export async function getFolderScan(userId: string, inputId: unknown) {
  const id = parseDeviceId(inputId);
  const device = await prisma.device.findFirst({ where: { id, userId }, select: {
    credentials: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true }, take: 1, orderBy: { createdAt: "desc" } },
    folderScan: { select: { credentialId: true, report: true, receivedAt: true } },
  } });
  if (!device) throw new DeviceError(404, "DEVICE_NOT_FOUND", "Device not found.");
  const saved = device.folderScan;
  if (!saved || device.credentials[0]?.id !== saved.credentialId) return { scan: null };
  const parsed = folderScanSchema.safeParse(saved.report);
  return { scan: parsed.success ? { ...parsed.data, receivedAt: saved.receivedAt } : null };
}
