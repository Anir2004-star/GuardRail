export type SourceKind = "Gmail" | "Google Drive" | "Device";
export type ConnectionStatus = "connected" | "disconnected" | "permission-required";
export type ExecutionState = "Pending" | "In progress" | "Completed" | "Partially completed" | "Failed" | "Cancelled";
export type ActionKind = "cleanup" | "organize";

export type StorageAccount = {
  id: string; name: string; identifier: string; providers: ("Gmail" | "Google Drive")[];
  connectionStatus: Record<"Gmail" | "Google Drive", ConnectionStatus>; lastSynced: string;
};
export type StorageReport = {
  id: string; ownerId: string; totalBytes: number; usedBytes: number; availableBytes: number;
  breakdown: { label: string; bytes: number }[]; reportedAt: string; confirmedChangeBytes: number | null;
};
export type StorageItem = {
  id: string; name: string; kind: "email" | "file" | "folder"; source: SourceKind; sourceId: string; sourceLabel: string;
  location: string; sender?: string; sizeBytes: number; relevantDate: string; dateLabel: "Received" | "Downloaded" | "Modified";
  category: string; reason: string; proposedAction: string; recoveryEstimateBytes: number | null; preview?: string;
  duplicateGroup?: string; childCount?: number;
};
export type CleanupSuggestion = { id: string; itemId: string; reviewStatus: "Waiting" | "Kept" | "Completed" | "Failed"; };
export type ProtectionRule = { id: string; itemId: string; sourceId: string; protectedAt: string; reason: string; inherited: boolean; ruleType?: "item" | "folder" | "sender"; criteria?: string; };
export type ActionResult = { itemId: string; state: "succeeded" | "failed" | "skipped"; message: string; };
export type ActionPlan = {
  id: string; action: ActionKind; itemIds: string[]; approvedAt: string; executionState: ExecutionState;
  results: ActionResult[]; attempts: number; storageRefreshState: "not-needed" | "waiting" | "confirmed";
  destination?: string; conversationId?: string;
};
export type ActivityEvent = {
  id: string; action: string; source: string; itemCount: number; timestamp: string; approvalState: "Approved" | "Not required";
  executionState: ExecutionState; resultSummary: string; itemIds: string[]; actionPlanId?: string; conversationId?: string;
};
export type ThresholdSettings = { ownerId: string; warning: number; high: number; alertsEnabled: boolean; };

const GB = 1_000_000_000;
const MB = 1_000_000;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const demoAccount: StorageAccount = {
  id: "account-google-demo", name: "Google account", identifier: "an••••@example.com", providers: ["Gmail", "Google Drive"],
  connectionStatus: { Gmail: "connected", "Google Drive": "permission-required" }, lastSynced: "2026-10-15T04:20:00.000Z",
};
export const demoStorageReport: StorageReport = {
  id: "report-google-demo", ownerId: demoAccount.id, totalBytes: 15 * GB, usedBytes: 12 * GB, availableBytes: 3 * GB,
  breakdown: [{ label: "Gmail", bytes: 4 * GB }, { label: "Google Drive", bytes: 7 * GB }, { label: "Other account usage", bytes: 1 * GB }],
  reportedAt: "2026-10-15T04:20:00.000Z", confirmedChangeBytes: null,
};
export const demoItems: StorageItem[] = [
  { id: "review-gmail-promo", name: "Autumn travel offers", kind: "email", source: "Gmail", sourceId: demoAccount.id, sourceLabel: "Gmail · an••••@example.com", location: "Promotions", sender: "offers@travel-demo.test", sizeBytes: 68 * MB, relevantDate: "2025-09-14T08:20:00.000Z", dateLabel: "Received", category: "Large email", reason: "Large attachment in an older promotional email. Review the message before deciding.", proposedAction: "Move the entire email to Gmail Trash", recoveryEstimateBytes: null, preview: "Sample preview: Save on autumn trips and download the attached destination guide…" },
  { id: "review-gmail-newsletter", name: "Design tools weekly", kind: "email", source: "Gmail", sourceId: demoAccount.id, sourceLabel: "Gmail · an••••@example.com", location: "Newsletters", sender: "digest@design-demo.test", sizeBytes: 22 * MB, relevantDate: "2025-12-02T10:00:00.000Z", dateLabel: "Received", category: "Newsletter", reason: "A large newsletter with attachments. Age alone does not make it unnecessary.", proposedAction: "Move the entire email to Gmail Trash", recoveryEstimateBytes: null, preview: "Sample preview: This week’s tools, tutorials, and community highlights…" },
  { id: "review-drive-installer", name: "Sketch-Installer-2025.dmg", kind: "file", source: "Google Drive", sourceId: demoAccount.id, sourceLabel: "Drive · an••••@example.com", location: "/Downloads/Installers", sizeBytes: 1.8 * GB, relevantDate: "2026-04-10T12:00:00.000Z", dateLabel: "Downloaded", category: "Old installer", reason: "Installation package downloaded six months ago. Confirm it is no longer needed.", proposedAction: "Move the file to Google Drive Trash", recoveryEstimateBytes: 1.8 * GB },
  { id: "review-drive-copy-a", name: "portfolio-assets.zip", kind: "file", source: "Google Drive", sourceId: demoAccount.id, sourceLabel: "Drive · an••••@example.com", location: "/Projects/Portfolio", sizeBytes: 940 * MB, relevantDate: "2026-06-18T09:15:00.000Z", dateLabel: "Modified", category: "Possible duplicate", reason: "Possible duplicate file. Compare both copies before deciding.", proposedAction: "Move the selected copy to Google Drive Trash", recoveryEstimateBytes: 940 * MB, duplicateGroup: "portfolio-zip" },
  { id: "review-drive-copy-b", name: "portfolio-assets-copy.zip", kind: "file", source: "Google Drive", sourceId: demoAccount.id, sourceLabel: "Drive · an••••@example.com", location: "/Archive/Portfolio", sizeBytes: 940 * MB, relevantDate: "2026-06-18T09:17:00.000Z", dateLabel: "Modified", category: "Possible duplicate", reason: "Possible duplicate file. Compare both copies before deciding.", proposedAction: "Move the selected copy to Google Drive Trash", recoveryEstimateBytes: 940 * MB, duplicateGroup: "portfolio-zip" },
  { id: "review-device-installer", name: "Xcode_15.4.xip", kind: "file", source: "Device", sourceId: "gr-device-laptop", sourceLabel: "Anirban’s MacBook", location: "~/Downloads", sizeBytes: 620 * MB, relevantDate: "2026-03-20T06:00:00.000Z", dateLabel: "Downloaded", category: "Old installer", reason: "An installation archive with a newer sample version present. Verify before moving it.", proposedAction: "Move the file to device Trash", recoveryEstimateBytes: 620 * MB },
  { id: "review-device-archive", name: "semester-recordings.zip", kind: "file", source: "Device", sourceId: "gr-device-laptop", sourceLabel: "Anirban’s MacBook", location: "~/Downloads", sizeBytes: 2.4 * GB, relevantDate: "2026-01-11T05:45:00.000Z", dateLabel: "Downloaded", category: "Large archive", reason: "A large archive in Downloads. Guardrail cannot determine whether its contents are still useful.", proposedAction: "Move the file to device Trash", recoveryEstimateBytes: 2.4 * GB },
  { id: "review-offline-video", name: "lecture-export.mp4", kind: "file", source: "Device", sourceId: "gr-device-tablet", sourceLabel: "College iPad", location: "Files/Downloads", sizeBytes: 1.2 * GB, relevantDate: "2026-05-07T13:30:00.000Z", dateLabel: "Downloaded", category: "Large file", reason: "A large file reported by an offline device. Its current state may be outdated.", proposedAction: "Move the file to device Trash", recoveryEstimateBytes: null },
  { id: "review-protected-tax", name: "Annual-tax-summary.pdf", kind: "file", source: "Google Drive", sourceId: demoAccount.id, sourceLabel: "Drive · an••••@example.com", location: "/Documents/Tax", sizeBytes: 3 * MB, relevantDate: "2026-03-28T08:00:00.000Z", dateLabel: "Modified", category: "Document", reason: "Protected important document.", proposedAction: "No action while protected", recoveryEstimateBytes: null },
  { id: "review-protected-folder", name: "Identity documents", kind: "folder", source: "Google Drive", sourceId: demoAccount.id, sourceLabel: "Drive · an••••@example.com", location: "/Documents/Identity", sizeBytes: 400 * MB, relevantDate: "2026-08-02T08:00:00.000Z", dateLabel: "Modified", category: "Folder", reason: "Protected folder. Its mock descendants inherit protection.", proposedAction: "Review folder contents before any action", recoveryEstimateBytes: null, childCount: 14 },
  { id: "review-drive-project-brief", name: "Guardrail-project-brief.pdf", kind: "file", source: "Google Drive", sourceId: demoAccount.id, sourceLabel: "Drive · an••••@example.com", location: "/My Drive", sizeBytes: 18 * MB, relevantDate: "2026-09-18T08:30:00.000Z", dateLabel: "Modified", category: "Project document", reason: "A project document that could be grouped with related work after review.", proposedAction: "Move to /Projects/Guardrail", recoveryEstimateBytes: 0 },
  { id: "review-drive-project-notes", name: "Guardrail-research-notes.docx", kind: "file", source: "Google Drive", sourceId: demoAccount.id, sourceLabel: "Drive · an••••@example.com", location: "/My Drive", sizeBytes: 7 * MB, relevantDate: "2026-09-21T10:45:00.000Z", dateLabel: "Modified", category: "Project document", reason: "A related project document that could be grouped after review.", proposedAction: "Move to /Projects/Guardrail", recoveryEstimateBytes: 0 },
  { id: "review-gmail-college", name: "Semester registration update", kind: "email", source: "Gmail", sourceId: demoAccount.id, sourceLabel: "Gmail · an••••@example.com", location: "Inbox", sender: "registrar@college-demo.test", sizeBytes: 14 * MB, relevantDate: "2026-08-12T09:00:00.000Z", dateLabel: "Received", category: "College email", reason: "A college-related message that can be protected or labelled after review.", proposedAction: "Apply the College label", recoveryEstimateBytes: null, preview: "Sample preview: Registration dates and course information for the coming semester…" },
];
export const demoSuggestions: CleanupSuggestion[] = demoItems.slice(0, 8).map((item) => ({ id: `suggestion-${item.id}`, itemId: item.id, reviewStatus: "Waiting" }));
export const demoProtectionRules: ProtectionRule[] = [
  { id: "protect-tax", itemId: "review-protected-tax", sourceId: demoAccount.id, protectedAt: "2026-10-10T07:30:00.000Z", reason: "Important financial record", inherited: false },
  { id: "protect-identity", itemId: "review-protected-folder", sourceId: demoAccount.id, protectedAt: "2026-10-09T06:15:00.000Z", reason: "Protect this folder and its mock descendants", inherited: true },
];
export const demoThresholds: ThresholdSettings[] = [
  { ownerId: demoAccount.id, warning: 70, high: 90, alertsEnabled: true },
  { ownerId: "gr-device-laptop", warning: 70, high: 90, alertsEnabled: true },
  { ownerId: "gr-device-tablet", warning: 70, high: 90, alertsEnabled: true },
];
export const demoActivity: ActivityEvent[] = [
  { id: "activity-seed-review", action: "Cleanup review created · Demo", source: "Gmail, Drive, and devices", itemCount: 8, timestamp: "2026-10-15T04:20:00.000Z", approvalState: "Not required", executionState: "Pending", resultSummary: "8 items waiting for review.", itemIds: demoItems.slice(0, 8).map((item) => item.id) },
  { id: "activity-seed-protect", action: "Items protected · Demo", source: "Google Drive", itemCount: 2, timestamp: "2026-10-10T07:30:00.000Z", approvalState: "Not required", executionState: "Completed", resultSummary: "2 sample items excluded from cleanup.", itemIds: ["review-protected-tax", "review-protected-folder"] },
];

export const formatBytes = (bytes: number) => bytes >= GB ? `${Number((bytes / GB).toFixed(2))} GB` : `${Math.round(bytes / MB)} MB`;
export const reviewDemoService = {
  async getOverview() { await wait(160); return { account: demoAccount, report: demoStorageReport }; },
  async listConnections() { await wait(140); return demoAccount.providers.map((provider) => ({ provider, status: demoAccount.connectionStatus[provider], identifier: demoAccount.identifier })); },
  async listSuggestions(items: StorageItem[], suggestions: CleanupSuggestion[]) { await wait(160); return suggestions.map((suggestion) => ({ suggestion, item: items.find((item) => item.id === suggestion.itemId)! })); },
  async getItemDetails(items: StorageItem[], id: string) { await wait(100); return items.find((item) => item.id === id) ?? null; },
  async protectItem(rules: ProtectionRule[], item: StorageItem, reason = "Protected during cleanup review") { await wait(220); return [...rules, { id: `protect-${item.id}`, itemId: item.id, sourceId: item.sourceId, protectedAt: new Date().toISOString(), reason, inherited: item.kind === "folder" }]; },
  async saveProtectionRule(rules: ProtectionRule[], items: StorageItem[], criteria: string, sender?: string) {
    await wait(320);
    const timestamp = new Date().toISOString();
    const existing = new Set(rules.map((rule) => rule.itemId));
    return [...rules, ...items.filter((item) => !existing.has(item.id)).map((item) => ({ id: `protect-rule-${item.id}`, itemId: item.id, sourceId: item.sourceId, protectedAt: timestamp, reason: criteria, inherited: item.kind === "folder", ruleType: sender ? "sender" as const : item.kind === "folder" ? "folder" as const : "item" as const, criteria }))];
  },
  async removeProtection(rules: ProtectionRule[], itemId: string) { await wait(220); return rules.filter((rule) => rule.itemId !== itemId); },
  async createActionPreview(action: ActionKind, itemIds: string[]): Promise<Pick<ActionPlan, "action" | "itemIds">> { await wait(180); return { action, itemIds }; },
  async executeDemoAction(action: ActionKind, itemIds: string[], attempt = 1): Promise<ActionResult[]> {
    await wait(850);
    return itemIds.map((itemId) => itemId === "review-drive-copy-b" && attempt === 1
      ? { itemId, state: "failed" as const, message: "Demo permission changed before execution. Review access and retry." }
      : { itemId, state: "succeeded" as const, message: action === "cleanup" ? "Moved to sample Trash." : "Applied the sample organization change." });
  },
  async listActivity(activity: ActivityEvent[]) { await wait(120); return activity; },
  async updateThresholds(settings: ThresholdSettings[], next: ThresholdSettings) { await wait(220); return settings.map((entry) => entry.ownerId === next.ownerId ? next : entry); },
  async refreshDemoStorageReport(report: StorageReport, recoveredBytes: number) { await wait(700); return { ...report, usedBytes: Math.max(0, report.usedBytes - recoveredBytes), availableBytes: Math.min(report.totalBytes, report.availableBytes + recoveredBytes), reportedAt: new Date().toISOString(), confirmedChangeBytes: recoveredBytes }; },
};
