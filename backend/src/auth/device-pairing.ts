import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Request } from "express";
import { DeviceError } from "../services/device.service.js";

export const PAIRING_TTL_SECONDS = 300;
export const DEVICE_CREDENTIAL_TTL_SECONDS = 30 * 24 * 60 * 60;
export function pairingHash(purpose: "code" | "claim" | "device", secret: string) {
  return createHash("sha256").update(`guardrail:${purpose}:v1:${secret}`).digest("hex");
}
export function createPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(12), (byte) => alphabet[byte & 31]).join("");
}
export const createPairingToken = (kind: "claim" | "device") => `${kind === "claim" ? "gr_pair_" : "gr_device_"}${randomBytes(32).toString("base64url")}`;
export const createComparisonCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");
export const invalidPairingCredential = () => new DeviceError(401, "INVALID_DEVICE_CREDENTIAL", "The device or pairing credential is invalid or expired.");
export function readPairingCredential(request: Request, kind: "claim" | "device") {
  const count = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "authorization").length;
  const scheme = kind === "claim" ? "Pairing" : "Device";
  const prefix = kind === "claim" ? "gr_pair_" : "gr_device_";
  const match = new RegExp(`^${scheme} (${prefix}[A-Za-z0-9_-]{43})$`).exec(request.headers.authorization ?? "");
  if (count !== 1 || !match?.[1] || Buffer.from(match[1].slice(prefix.length), "base64url").toString("base64url") !== match[1].slice(prefix.length)) throw invalidPairingCredential();
  return pairingHash(kind, match[1]);
}
