"use client";

import { z } from "zod";
import { useAuthSession } from "@/components/auth-store";
import { authenticatedGet } from "./authenticated-api";
import { rejectAccessSession, restoreOrRenewSession } from "./session-coordinator";

export const registeredDeviceSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(60), type: z.enum(["Laptop", "Smartphone", "Tablet"]),
  brand: z.string().max(80).nullable(), model: z.string().max(80).nullable(), os: z.string().max(80).nullable(),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  status: z.literal("registered"), paired: z.literal(false), storage: z.null(),
});
export type RegisteredDevice = z.infer<typeof registeredDeviceSchema>;
export type DeviceRegistration = { requestId: string; name: string; type: RegisteredDevice["type"]; brand: string; model: string; os: string };
export const DEVICES_CHANGED = "guardrail:devices-changed";
type WriteResult<T> = { ok: true; data: T } | { ok: false; message: string; uncertain?: boolean; cancelled?: boolean };
const single = z.object({ device: registeredDeviceSchema });
// A reload after a mutation must start a fresh read, even if an older snapshot
// is still in flight. Request epochs in the UI discard late older results.
export function getRegisteredDevices() { return authenticatedGet("/api/v1/devices", z.object({ devices: z.array(registeredDeviceSchema).max(100) }), { deduplicate: false }); }
function devicePath(id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new Error("Use a valid device identifier");
  return `/api/v1/devices/${id}`;
}
export function getRegisteredDevice(id: string) { return authenticatedGet(devicePath(id), single, { deduplicate: false }); }

async function write<T>(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown, schema: z.ZodType<T>): Promise<WriteResult<T>> {
  const initial = useAuthSession.getState();
  const ownerId = initial.session?.user.id;
  const cancelled = (): WriteResult<T> => ({ ok: false, cancelled: true, message: "Your session changed. Reopen My devices to continue." });
  if (initial.status === "demo" || !ownerId) return cancelled();
  if (initial.session!.expiresAt <= Date.now() + 30000) await restoreOrRenewSession();
  let session = useAuthSession.getState().session;
  if (!session || session.user.id !== ownerId || session.expiresAt <= Date.now()) return cancelled();
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const send = (token: string) => fetch(`${apiUrl}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    let response = await send(session.accessToken);
    if (useAuthSession.getState().session?.accessToken !== session.accessToken) return cancelled();
    if (response.status === 401) {
      // Authentication runs before every mutation. A definite 401 has no side
      // effects; only this response can trigger one retry with a renewed token.
      const rejected = session.accessToken;
      await restoreOrRenewSession(rejected);
      session = useAuthSession.getState().session;
      if (!session || session.user.id !== ownerId || session.accessToken === rejected || session.expiresAt <= Date.now()) {
        rejectAccessSession(rejected); return cancelled();
      }
      response = await send(session.accessToken);
      if (useAuthSession.getState().session?.accessToken !== session.accessToken) return cancelled();
    }
    if (response.status === 401) { rejectAccessSession(session.accessToken); return cancelled(); }
    if (response.status === 403) return { ok: false, message: "Device changes are unavailable from this website or account." };
    if (response.status === 404) return { ok: false, message: "Device not found. Refresh your device list." };
    if (response.status === 400) return { ok: false, message: "Check the device details. Name is required (60 characters maximum); other fields allow up to 80 characters." };
    if (response.status === 429) return { ok: false, message: "Too many device changes. Please try again later." };
    if (response.status === 409) {
      const payload: unknown = await response.json().catch(() => undefined);
      const limit = z.object({ error: z.object({ code: z.literal("DEVICE_LIMIT_REACHED") }) }).safeParse(payload);
      return { ok: false, message: limit.success ? "Your account has reached the 100-device limit. Remove a device first." : "This registration request already saved different details. Refresh your devices before trying again." };
    }
    const expected = method === "POST" ? 201 : method === "DELETE" ? 204 : 200;
    const payload: unknown = response.status === 204 ? null : await response.json().catch(() => undefined);
    if (useAuthSession.getState().session?.accessToken !== session.accessToken) return cancelled();
    if (response.status === expected) {
      const parsed = schema.safeParse(payload);
      if (parsed.success) {
        // Let a successful dialog close/navigation finish before invalidating
        // lists; an old account's response must never refresh another account.
        window.setTimeout(() => {
          if (useAuthSession.getState().session?.user.id === ownerId) window.dispatchEvent(new Event(DEVICES_CHANGED));
        }, 0);
        return { ok: true, data: parsed.data };
      }
    }
    return { ok: false, uncertain: true, message: "Could not confirm the device change. Refresh your device list before retrying." };
  } catch {
    if (useAuthSession.getState().session?.user.id !== ownerId) return cancelled();
    return { ok: false, uncertain: true, message: "Could not confirm the device change. Check your connection and refresh your device list before retrying." };
  }
}
export function registerAccountDevice(input: DeviceRegistration) { return write("POST", "/api/v1/devices", input, single); }
export function renameAccountDevice(id: string, name: string) { return write("PATCH", devicePath(id), { name }, single); }
export function removeAccountDevice(id: string) { return write("DELETE", devicePath(id), undefined, z.null()); }
