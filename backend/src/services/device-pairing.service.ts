import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import type { Prisma, DevicePairingSession } from "../generated/prisma/client.js";
import { assertEmailAccess } from "../auth/email-verification.js";
import { createComparisonCode, createPairingCode, createPairingToken, DEVICE_CREDENTIAL_TTL_SECONDS, invalidPairingCredential, PAIRING_TTL_SECONDS, pairingHash } from "../auth/device-pairing.js";
import { parseDeviceId } from "../validation/device.validation.js";
import { approvalSchema, claimSchema, emptyPairingSchema, parsePairing } from "../validation/pairing.validation.js";
import { DeviceError } from "./device.service.js";

const active = ["Waiting", "Claimed", "Approved"] as const;
const conflict = () => new DeviceError(409, "PAIRING_STATE_CHANGED", "Pairing changed or expired. Refresh pairing before continuing.");
const missing = () => new DeviceError(404, "DEVICE_NOT_FOUND", "Device not found.");
const options = { maxWait: 5000, timeout: 10000 };
function view(session: DevicePairingSession) {
  return { id: session.id, state: active.includes(session.state as typeof active[number]) && session.expiresAt <= new Date() ? "Expired" : session.state,
    expiresAt: session.expiresAt, claimId: session.claimId, comparisonCode: session.comparisonCode,
    candidate: session.appName ? { appName: session.appName, platform: session.platform, appVersion: session.appVersion } : null };
}
export async function lockDevice(tx: Prisma.TransactionClient, userId: string, id: string) {
  // The same lock order is used by claims, owner decisions and exchanges.
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  const owner = await tx.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true, emailVerificationExempt: true } });
  if (!owner) throw missing();
  assertEmailAccess(owner);
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "devices" WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw missing();
}
export async function startDevicePairing(userId: string, inputId: unknown, input: unknown) {
  const id = parseDeviceId(inputId); parsePairing(emptyPairingSchema, input);
  return prisma.$transaction(async (tx) => {
    await lockDevice(tx, userId, id);
    const previous = await tx.devicePairingSession.findFirst({ where: { deviceId: id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const createdAt = new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1));
    // Bound retained history without dropping a completed credential's session.
    await tx.devicePairingSession.deleteMany({ where: { deviceId: id, credential: null, OR: [{ expiresAt: { lte: new Date() } }, { state: { in: ["Cancelled", "Rejected"] } }] } });
    await tx.devicePairingSession.updateMany({ where: { deviceId: id, state: { in: [...active] } }, data: { state: "Cancelled" } });
    const code = createPairingCode();
    const session = await tx.devicePairingSession.create({ data: { deviceId: id, codeHash: pairingHash("code", code), createdAt, expiresAt: new Date(Date.now() + PAIRING_TTL_SECONDS * 1000) } });
    return { pairing: view(session), code: code.match(/.{4}/g)!.join("-") };
  }, options);
}
export async function getDevicePairing(userId: string, inputId: unknown) {
  const id = parseDeviceId(inputId);
  if (!await prisma.device.findFirst({ where: { id, userId }, select: { id: true } })) throw missing();
  const session = await prisma.devicePairingSession.findFirst({ where: { deviceId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return { pairing: session ? view(session) : null };
}
export async function decideDevicePairing(userId: string, inputId: unknown, inputPairingId: unknown, decision: "approve" | "reject" | "cancel", input: unknown) {
  const id = parseDeviceId(inputId); const pairingId = parseDeviceId(inputPairingId);
  const claimId = decision === "approve" ? parsePairing(approvalSchema, input).claimId : (parsePairing(emptyPairingSchema, input), null);
  return prisma.$transaction(async (tx) => {
    await lockDevice(tx, userId, id);
    const session = await tx.devicePairingSession.findFirst({ where: { id: pairingId, deviceId: id } });
    if (!session) throw missing();
    if (decision === "approve" && claimId === session.claimId && ["Approved", "Completed"].includes(session.state)) return { pairing: view(session) };
    if (session.expiresAt <= new Date() || !active.includes(session.state as typeof active[number])) throw conflict();
    if (decision === "approve" && (session.state !== "Claimed" || claimId !== session.claimId)) throw conflict();
    return { pairing: view(await tx.devicePairingSession.update({ where: { id: session.id }, data: { state: decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Cancelled" } })) };
  }, options);
}
export async function claimDevicePairing(input: unknown) {
  const data = parsePairing(claimSchema, input);
  const hint = await prisma.devicePairingSession.findUnique({ where: { codeHash: pairingHash("code", data.code) }, select: { id: true, deviceId: true, device: { select: { userId: true } } } });
  if (!hint) throw conflict();
  return prisma.$transaction(async (tx) => {
    await lockDevice(tx, hint.device.userId, hint.deviceId);
    const session = await tx.devicePairingSession.findUnique({ where: { id: hint.id } });
    if (!session || session.state !== "Waiting" || session.expiresAt <= new Date()) throw conflict();
    const token = createPairingToken("claim");
    const updated = await tx.devicePairingSession.update({ where: { id: session.id }, data: { state: "Claimed", claimId: randomUUID(), claimTokenHash: pairingHash("claim", token), comparisonCode: createComparisonCode(), appName: data.appName, platform: data.platform, appVersion: data.appVersion ?? null } });
    return { pairingId: updated.id, claimToken: token, comparisonCode: updated.comparisonCode, expiresAt: updated.expiresAt, pollIntervalSeconds: 5 };
  }, options);
}
export async function getCompanionPairing(hash: string) {
  const session = await prisma.devicePairingSession.findUnique({ where: { claimTokenHash: hash } });
  if (!session) throw invalidPairingCredential();
  // Companion gets no owner/profile or other device information.
  return { state: view(session).state, comparisonCode: session.comparisonCode, expiresAt: session.expiresAt, pollIntervalSeconds: 5 };
}
export async function exchangeDevicePairing(hash: string, input: unknown) {
  parsePairing(emptyPairingSchema, input);
  const hint = await prisma.devicePairingSession.findUnique({ where: { claimTokenHash: hash }, select: { id: true, deviceId: true, device: { select: { userId: true } } } });
  if (!hint) throw invalidPairingCredential();
  return prisma.$transaction(async (tx) => {
    await lockDevice(tx, hint.device.userId, hint.deviceId);
    const session = await tx.devicePairingSession.findUnique({ where: { id: hint.id } });
    if (!session || session.state !== "Approved" || session.expiresAt <= new Date()) throw conflict();
    const now = new Date(); const token = createPairingToken("device");
    await tx.deviceCredential.updateMany({ where: { deviceId: hint.deviceId, revokedAt: null }, data: { revokedAt: now } });
    const credential = await tx.deviceCredential.create({ data: { deviceId: hint.deviceId, pairingId: session.id, tokenHash: pairingHash("device", token), expiresAt: new Date(now.getTime() + DEVICE_CREDENTIAL_TTL_SECONDS * 1000) } });
    await tx.devicePairingSession.update({ where: { id: session.id }, data: { state: "Completed" } });
    return { deviceId: hint.deviceId, deviceToken: token, expiresAt: credential.expiresAt };
  }, options);
}
export async function getCompanionDevice(hash: string) {
  const credential = await prisma.deviceCredential.findUnique({ where: { tokenHash: hash }, select: { revokedAt: true, expiresAt: true, device: { select: { id: true, name: true, type: true, user: { select: { emailVerifiedAt: true, emailVerificationExempt: true } } } } } });
  if (!credential || credential.revokedAt || credential.expiresAt <= new Date()) throw invalidPairingCredential();
  assertEmailAccess(credential.device.user);
  return { device: { id: credential.device.id, name: credential.device.name, type: credential.device.type }, credentialExpiresAt: credential.expiresAt };
}
export async function disconnectDevice(userId: string, inputId: unknown, input: unknown) {
  const id = parseDeviceId(inputId); parsePairing(emptyPairingSchema, input);
  await prisma.$transaction(async (tx) => {
    await lockDevice(tx, userId, id);
    await tx.deviceCredential.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.devicePairingSession.updateMany({ where: { deviceId: id, state: { in: [...active] } }, data: { state: "Cancelled" } });
  }, options);
}

export async function disconnectCompanion(hash: string, input: unknown) {
  parsePairing(emptyPairingSchema, input);
  const hint = await prisma.deviceCredential.findUnique({ where: { tokenHash: hash }, select: { id: true, deviceId: true, device: { select: { userId: true } } } });
  if (!hint) throw invalidPairingCredential();
  await prisma.$transaction(async (tx) => {
    await lockDevice(tx, hint.device.userId, hint.deviceId);
    const credential = await tx.deviceCredential.findUnique({ where: { id: hint.id } });
    if (!credential || credential.revokedAt || credential.expiresAt <= new Date()) throw invalidPairingCredential();
    await tx.deviceCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
  }, options);
}
