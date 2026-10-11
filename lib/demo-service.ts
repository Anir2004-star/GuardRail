export type Item = { id: string; name: string; provider: "Gmail" | "Google Drive"; kind: string; category: string; date: string; starred?: boolean; sender?: string; mb: number; folder: string; protected: boolean; trashed: boolean };
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

export type Device = { id: string; category: "Smartphone" | "Tablet" | "Laptop"; name: string; brand: string; model: string; os: string; capacity: number; used: number; updated: string };
export const seedDevices: Device[] = [
  { id: "gr-device-laptop", category: "Laptop", name: "Study laptop", brand: "Lenovo", model: "IdeaPad", os: "Windows", capacity: 512, used: 286, updated: "2026-10-11T04:00:00Z" },
  { id: "gr-device-phone", category: "Smartphone", name: "Personal iPhone", brand: "Apple", model: "iPhone 15", os: "iOS", capacity: 128, used: 94, updated: "2026-10-11T04:00:00Z" },
  { id: "gr-device-tablet", category: "Tablet", name: "College iPad", brand: "Apple", model: "iPad Air", os: "iPadOS", capacity: 256, used: 232, updated: "2026-10-11T04:00:00Z" },
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
