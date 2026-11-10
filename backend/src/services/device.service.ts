import { prisma } from "../config/database.js";
import type { Prisma } from "../generated/prisma/client.js";
import { assertEmailAccess } from "../auth/email-verification.js";
import { InvalidAccessTokenError } from "../errors/auth.errors.js";
import { parseDeviceId, parseDeviceRegistration, parseDeviceRename } from "../validation/device.validation.js";
import { storageVolumesSchema } from "../validation/storage-report.validation.js";

export class DeviceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
const missing = () => new DeviceError(404, "DEVICE_NOT_FOUND", "Device not found.");
const fields = { id: true, name: true, type: true, brand: true, model: true, os: true, createdAt: true, updatedAt: true,
  credentials: { where: { revokedAt: null }, select: { id: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
  storageReport: { select: { credentialId: true, collectedAt: true, receivedAt: true, volumes: true } },
} satisfies Prisma.DeviceSelect;
type DeviceRecord = Prisma.DeviceGetPayload<{ select: typeof fields }>;
const publicDevice = ({ credentials, storageReport, ...device }: DeviceRecord) => {
  const credential = credentials.find((value) => value.expiresAt > new Date());
  const parsed = storageVolumesSchema.safeParse(storageReport?.volumes);
  const volumes = parsed.success ? parsed.data.map((volume) => ({ ...volume, usedBytes: volume.totalBytes - volume.freeBytes })) : [];
  const storage = credential && storageReport?.credentialId === credential.id && volumes.length ? {
    collectedAt: storageReport.collectedAt, receivedAt: storageReport.receivedAt, volumes,
    totalBytes: volumes.reduce((sum, volume) => sum + volume.totalBytes, 0),
    freeBytes: volumes.reduce((sum, volume) => sum + volume.freeBytes, 0),
    usedBytes: volumes.reduce((sum, volume) => sum + volume.usedBytes, 0),
  } : null;
  return { ...device, status: credential ? "paired" as const : "registered" as const, paired: !!credential,
    pairedAt: credential?.createdAt ?? null, credentialExpiresAt: credential?.expiresAt ?? null, storage };
};

export async function registerDevice(userId: string, input: unknown) {
  const data = parseDeviceRegistration(input);
  return prisma.$transaction(async (transaction) => {
    // Serialize retries and the per-account cap; the owner is never input data.
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    const owner = await transaction.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true, emailVerificationExempt: true } });
    if (!owner) throw new InvalidAccessTokenError();
    assertEmailAccess(owner);
    const existing = await transaction.device.findUnique({ where: { userId_requestId: { userId, requestId: data.requestId } }, select: fields });
    if (existing) {
      if (existing.name !== data.name || existing.type !== data.type || existing.brand !== data.brand || existing.model !== data.model || existing.os !== data.os) {
        throw new DeviceError(409, "DEVICE_REQUEST_CONFLICT", "This registration request already saved different device details. Refresh your devices before trying again.");
      }
      return publicDevice(existing);
    }
    if (await transaction.device.count({ where: { userId } }) >= 100) throw new DeviceError(409, "DEVICE_LIMIT_REACHED", "You can register up to 100 devices. Remove a device before adding another.");
    return publicDevice(await transaction.device.create({ data: { userId, ...data }, select: fields }));
  }, { maxWait: 5000, timeout: 10000 });
}
export async function listDevices(userId: string) {
  return (await prisma.device.findMany({ where: { userId }, select: fields, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 })).map(publicDevice);
}
export async function getDevice(userId: string, inputId: unknown) {
  const id = parseDeviceId(inputId);
  const device = await prisma.device.findFirst({ where: { id, userId }, select: fields });
  if (!device) throw missing();
  return publicDevice(device);
}
export async function renameDevice(userId: string, inputId: unknown, input: unknown) {
  const id = parseDeviceId(inputId); const { name } = parseDeviceRename(input);
  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.device.updateMany({ where: { id, userId }, data: { name } });
    if (!updated.count) throw missing();
    const device = await transaction.device.findFirst({ where: { id, userId }, select: fields });
    if (!device) throw missing();
    return publicDevice(device);
  });
}
export async function removeDevice(userId: string, inputId: unknown): Promise<void> {
  const id = parseDeviceId(inputId);
  if (!(await prisma.device.deleteMany({ where: { id, userId } })).count) throw missing();
}
