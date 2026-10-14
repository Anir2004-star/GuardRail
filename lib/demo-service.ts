export type Item = { id: string; name: string; provider: "Gmail" | "Google Drive"; kind: string; category: string; date: string; starred?: boolean; sender?: string; mb: number; folder: string; protected: boolean; trashed: boolean };

export type DeviceType = "Laptop" | "Smartphone" | "Tablet";
export type StorageSummary = { totalGb: number; usedGb: number; availableGb: number; usagePercent: number };
export type DevicePermission = { id: string; name: string; status: "Allowed" | "Not granted" };
export type CleanupCandidate = { id: string; name: string; path: string; sizeMb: number; reason: string; state: "suggested" | "kept" | "trashed" };
export type ActivityEvent = { id: string; text: string; time: string; type: "content" | "sync" | "execution" | "account" | "device" };
export type Device = {
  id: string;
  name: string;
  category: DeviceType;
  brand: string;
  model: string;
  os: string;
  status: "connected" | "offline";
  updated: string;
  storage: StorageSummary;
  permissions: DevicePermission[];
  cleanupCandidates: CleanupCandidate[];
  activity: ActivityEvent[];
};
export type PairingSession = {
  id: string;
  deviceType: DeviceType;
  code: string;
  expiresAt: string;
  status: "active" | "verifying" | "expired" | "verified";
  device: Omit<Device, "id">;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const storage = (totalGb: number, usedGb: number): StorageSummary => ({ totalGb, usedGb, availableGb: Math.round((totalGb - usedGb) * 100) / 100, usagePercent: Math.round((usedGb / totalGb) * 100) });
const permissions = (): DevicePermission[] => [
  { id: "downloads", name: "Downloads folder", status: "Allowed" },
  { id: "documents", name: "Documents folder", status: "Not granted" },
  { id: "other", name: "Other folders", status: "Not granted" },
];
const candidates = (seedKey?: string): CleanupCandidate[] => [
  { id: seedKey ? `${seedKey}-installer` : uid("cleanup"), name: "Guardrail-Installer-old.dmg", path: "~/Downloads/Guardrail-Installer-old.dmg", sizeMb: 184, reason: "An older installer with a newer sample version in Downloads.", state: "suggested" },
  { id: seedKey ? `${seedKey}-archive` : uid("cleanup"), name: "course-assets.zip", path: "~/Downloads/course-assets.zip", sizeMb: 2160, reason: "A large archive that has not appeared in recent sample activity.", state: "suggested" },
  { id: seedKey ? `${seedKey}-duplicate` : uid("cleanup"), name: "project-brief-copy.pdf", path: "~/Downloads/project-brief-copy.pdf", sizeMb: 12, reason: "A possible duplicate by sample name and size. Review before acting.", state: "suggested" },
];
const activity = (text: string, time = new Date().toISOString()): ActivityEvent => ({ id: uid("activity"), text, time, type: "device" });

function sampleDevice(deviceType: DeviceType): Omit<Device, "id"> {
  const now = new Date().toISOString();
  const details = deviceType === "Laptop"
    ? { name: "Anirban’s MacBook", brand: "Apple", model: "MacBook Air", os: "macOS", storage: storage(512, 400) }
    : deviceType === "Tablet"
      ? { name: "Anirban’s iPad", brand: "Apple", model: "iPad Air", os: "iPadOS", storage: storage(256, 196) }
      : { name: "Anirban’s phone", brand: "Google", model: "Pixel 9", os: "Android", storage: storage(128, 96) };
  return { ...details, category: deviceType, status: "connected", updated: now, permissions: permissions(), cleanupCandidates: candidates(), activity: [activity("Demo device details received from the sample companion app.", now)] };
}

export const deviceService = {
  async listDevices(devices: Device[]) { await wait(120); return devices; },
  async createDemoPairingSession(deviceType: DeviceType): Promise<PairingSession> {
    await wait(180);
    return { id: uid("pairing"), deviceType, code: String(Math.floor(100000 + Math.random() * 900000)), expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), status: "active", device: sampleDevice(deviceType) };
  },
  async verifyDemoPairingCode(session: PairingSession, code: string): Promise<PairingSession> {
    await wait(850);
    if (session.status === "expired" || Date.now() >= new Date(session.expiresAt).getTime()) throw new Error("This demo code has expired. Generate a new code and try again.");
    if (code !== session.code) throw new Error("That code does not match the current demo code.");
    return { ...session, status: "verified" };
  },
  async confirmDemoDeviceConnection(devices: Device[], session: PairingSession): Promise<Device[]> {
    await wait(450);
    if (session.status !== "verified") throw new Error("Verify the current demo code before connecting this device.");
    return [...devices, { ...session.device, id: uid("gr-device") }];
  },
  async renameDevice(devices: Device[], id: string, name: string): Promise<Device[]> {
    await wait(250);
    const nextName = name.trim();
    if (!nextName) throw new Error("Enter a device name.");
    return devices.map((device) => device.id === id ? { ...device, name: nextName, activity: [activity(`Demo device renamed to ${nextName}.`), ...device.activity] } : device);
  },
  async disconnectDevice(devices: Device[], id: string): Promise<Device[]> { await wait(250); return devices.filter((device) => device.id !== id); },
  async getDeviceDetails(devices: Device[], id: string): Promise<Device | null> { await wait(100); return devices.find((device) => device.id === id) ?? null; },
  async simulatePermission(devices: Device[], deviceId: string, permissionId: string): Promise<Device[]> {
    await wait(250);
    return devices.map((device) => device.id === deviceId ? { ...device, permissions: device.permissions.map((permission) => permission.id === permissionId ? { ...permission, status: permission.status === "Allowed" ? "Not granted" : "Allowed" } : permission), activity: [activity("A folder permission was changed in the demo."), ...device.activity] } : device);
  },
  async keepCleanupCandidate(devices: Device[], deviceId: string, candidateId: string): Promise<Device[]> {
    await wait(180);
    return devices.map((device) => device.id === deviceId ? { ...device, cleanupCandidates: device.cleanupCandidates.map((candidate) => candidate.id === candidateId ? { ...candidate, state: "kept" } : candidate), activity: [activity("A cleanup suggestion was kept in the demo."), ...device.activity] } : device);
  },
  async simulateCleanup(devices: Device[], deviceId: string, candidateIds: string[]): Promise<Device[]> {
    await wait(650);
    return devices.map((device) => device.id === deviceId ? { ...device, cleanupCandidates: device.cleanupCandidates.map((candidate) => candidateIds.includes(candidate.id) ? { ...candidate, state: "trashed" } : candidate), activity: [activity(`Simulated moving ${candidateIds.length} file${candidateIds.length === 1 ? "" : "s"} to Trash. Storage totals were not changed.`), ...device.activity] } : device);
  },
};

export const seedItems: Item[] = [
  { id: "mail-1", name: "Weekly shopping offers", provider: "Gmail", kind: "Email", category: "Promotions", date: "2024-06-12", sender: "offers@example.com", mb: 8, folder: "Promotions", protected: false, trashed: false },
  { id: "mail-2", name: "October newsletter", provider: "Gmail", kind: "Email", category: "Promotions", date: "2024-06-12", sender: "offers@example.com", mb: 4, folder: "Promotions", protected: false, trashed: false },
  { id: "mail-3", name: "Your travel receipt", provider: "Gmail", kind: "Email", category: "Receipts", date: "2026-10-01", starred: true, sender: "travel@example.com", mb: 2, folder: "Receipts", protected: true, trashed: false },
  { id: "drive-1", name: "Project-export-v1.zip", provider: "Google Drive", kind: "Archive", category: "Projects", date: "2025-03-18", mb: 1400, folder: "Projects", protected: false, trashed: false },
  { id: "drive-2", name: "Project-export-copy.zip", provider: "Google Drive", kind: "Archive", category: "Projects", date: "2025-03-18", mb: 1400, folder: "Projects", protected: false, trashed: false },
  { id: "drive-3", name: "Annual-tax-summary.pdf", provider: "Google Drive", kind: "Document", category: "Important documents", date: "2025-03-18", mb: 3, folder: "Documents", protected: true, trashed: false },
  { id: "drive-4", name: "Workshop-recording.mp4", provider: "Google Drive", kind: "Video", category: "Projects", date: "2025-03-18", mb: 2200, folder: "Recordings", protected: false, trashed: false },
  { id: "drive-5", name: "Portfolio-final.pdf", provider: "Google Drive", kind: "Document", category: "Projects", date: "2025-03-18", mb: 24, folder: "Projects", protected: false, trashed: false },
  { id: "drive-6", name: "Project-diagram.png", provider: "Google Drive", kind: "Image", category: "Projects", date: "2026-09-28", mb: 12, folder: "Projects", protected: false, trashed: false },
  { id: "trash-1", name: "Archived event newsletter", provider: "Gmail", kind: "Email", category: "Promotions", date: "2024-06-12", sender: "offers@example.com", mb: 3, folder: "Promotions", protected: false, trashed: true },
];
export const proposals = [
  { id: "newsletters", title: "Old newsletters and promotions", reason: "These sample messages are promotions. Review the sender and content before moving them to trash.", action: "trash", ids: ["mail-1", "mail-2", "mail-3"], risk: "Low" },
  { id: "duplicates", title: "Duplicate project exports", reason: "These sample exports have matching sizes. Verify their content before removing a copy; the original will be kept.", action: "trash", ids: ["drive-2"], risk: "Medium" },
  { id: "recordings", title: "Organize large recordings", reason: "Move this sample recording into an Archive folder so it is easier to find later. Organization does not free storage.", action: "archive", ids: ["drive-4"], risk: "Medium" },
] as const;

const seedTime = "2026-10-11T04:00:00Z";
const makeSeed = (id: string, category: DeviceType, name: string, brand: string, model: string, os: string, total: number, used: number, status: Device["status"] = "connected"): Device => ({ id, category, name, brand, model, os, status, updated: seedTime, storage: storage(total, used), permissions: permissions(), cleanupCandidates: candidates(id), activity: [{ id: `${id}-activity`, text: "Sample device added to this demo workspace.", time: seedTime, type: "device" }] });
export const seedDevices: Device[] = [
  makeSeed("gr-device-laptop", "Laptop", "Anirban’s MacBook", "Apple", "MacBook Air", "macOS", 512, 400),
  makeSeed("gr-device-phone", "Smartphone", "Personal Pixel", "Google", "Pixel 9", "Android", 128, 94),
  makeSeed("gr-device-tablet", "Tablet", "College iPad", "Apple", "iPad Air", "iPadOS", 256, 232, "offline"),
];

export const defaultPreferences = { threshold: 70, criticalThreshold: 90, emailAlerts: false, protectReceipts: true, protectStarred: true, protectDocuments: true, selectedSenders: "", protectedFolders: "", appearance: "light" as "light" | "charcoal" };
export type Preferences = typeof defaultPreferences;
export function protectionReason(item: Item, prefs: Preferences): string | null {
  if (item.protected) return "Selected item";
  if (item.provider === "Gmail" && prefs.protectStarred && item.starred) return "Starred email rule";
  if (prefs.protectReceipts && item.category === "Receipts") return "Receipt rule";
  if (prefs.protectDocuments && item.category === "Important documents") return "Legal / identity document rule";
  if (item.provider === "Gmail" && prefs.selectedSenders.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(item.sender?.toLowerCase() ?? "")) return "Selected sender rule";
  if (item.provider === "Google Drive" && prefs.protectedFolders.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(item.folder.toLowerCase())) return "Selected Drive folder rule";
  return null;
}
export const demoService = {
  organize: (items: Item[], ids: string[], destination: string) => items.map((i) => ids.includes(i.id) && !i.trashed ? { ...i, folder: destination } : i),
  restore: (items: Item[], id: string) => items.map((i) => i.id === id ? { ...i, trashed: false } : i),
  toggleProtection: (items: Item[], id: string) => items.map((i) => i.id === id ? { ...i, protected: !i.protected } : i),
  execute: (items: Item[], ids: string[], action: string) => items.map((i) => ids.includes(i.id) ? { ...i, trashed: action === "trash", folder: action === "archive" ? "Archive" : i.folder } : i),
  isProtected: (item: Item, prefs: Preferences) => !!protectionReason(item, prefs),
  eligible: (item: Item, prefs: Preferences, connections: string[]) => !protectionReason(item, prefs) && !item.trashed && connections.includes(item.provider),
  cloudUsage: (items: Item[]) => ["Gmail", "Google Drive"].map((provider) => ({ name: provider, value: items.filter((i) => i.provider === provider).reduce((sum, i) => sum + i.mb, 0), color: provider === "Gmail" ? "#d97732" : "#5b2a68" })),
};
export const instructions = [
  "Find promotional emails older than one year. Keep starred messages and receipts.",
  "Find duplicate Google Drive files. Keep the original files in my Projects folder.",
  "Show large Drive files for review. Do not delete anything yet.",
  "Suggest labels for my college emails and folders for project documents.",
];

const demoMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDemoDateTime(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "Unknown time";
  const indiaTime = new Date(instant.getTime() + 330 * 60 * 1000);
  const hours = indiaTime.getUTCHours();
  const minutes = String(indiaTime.getUTCMinutes()).padStart(2, "0");
  const displayHour = hours % 12 || 12;
  const meridiem = hours >= 12 ? "PM" : "AM";
  return `${indiaTime.getUTCDate()} ${demoMonths[indiaTime.getUTCMonth()]} ${indiaTime.getUTCFullYear()}, ${displayHour}:${minutes} ${meridiem}`;
}
