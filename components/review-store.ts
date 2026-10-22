"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ActionKind, ActionPlan, ActivityEvent, CleanupSuggestion, demoAccount, demoActivity, demoItems,
  demoProtectionRules, demoStorageReport, demoSuggestions, demoThresholds, ProtectionRule,
  reviewDemoService, StorageAccount, StorageItem, StorageReport, ThresholdSettings,
} from "@/lib/review-demo";
import { useDemo } from "./demo-store";

type ReviewState = {
  account: StorageAccount; report: StorageReport; items: StorageItem[]; suggestions: CleanupSuggestion[];
  protections: ProtectionRule[]; plans: ActionPlan[]; activity: ActivityEvent[]; thresholds: ThresholdSettings[];
  lastRefreshed: string; connectionStatus: StorageAccount["connectionStatus"]; selectedItemIds: string[];
  protectItem: (itemId: string) => Promise<void>; removeProtection: (itemId: string) => Promise<void>;
  protectItemsByRule: (itemIds: string[], criteria: string, sender?: string) => Promise<void>;
  keepItem: (itemId: string) => void; setSelectedItemIds: (ids: string[]) => void; toggleSelectedItem: (id: string) => void; clearSelection: () => void;
  executeAction: (action: ActionKind, itemIds: string[], options?: { destination?: string; conversationId?: string }) => Promise<string>;
  retryAction: (planId: string) => Promise<void>; updateThreshold: (settings: ThresholdSettings) => Promise<void>;
  refreshStorage: () => Promise<void>; toggleConnection: (provider: "Gmail" | "Google Drive") => void;
  recordActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void; resetReviewDemo: () => void;
};
const now = () => new Date().toISOString();
const initialReviewState = () => ({
  account: demoAccount, report: demoStorageReport, items: demoItems, suggestions: demoSuggestions,
  protections: demoProtectionRules, plans: [] as ActionPlan[], activity: demoActivity, thresholds: demoThresholds,
  lastRefreshed: demoStorageReport.reportedAt, connectionStatus: demoAccount.connectionStatus, selectedItemIds: [] as string[],
});

export const useReviewDemo = create<ReviewState>()(persist((set, get) => ({
  ...initialReviewState(),
  protectItem: async (itemId) => {
    const item = get().items.find((entry) => entry.id === itemId); if (!item || get().protections.some((rule) => rule.itemId === itemId)) return;
    const protections = await reviewDemoService.protectItem(get().protections, item);
    set((state) => ({ protections, selectedItemIds: state.selectedItemIds.filter((id) => id !== itemId), activity: [{ id: crypto.randomUUID(), action: "Item protected · Demo", source: item.sourceLabel, itemCount: 1, timestamp: now(), approvalState: "Not required", executionState: "Completed", resultSummary: "Excluded from cleanup selection.", itemIds: [itemId] }, ...state.activity] }));
  },
  removeProtection: async (itemId) => {
    const item = get().items.find((entry) => entry.id === itemId); if (!item) return;
    const protections = await reviewDemoService.removeProtection(get().protections, itemId);
    set((state) => ({ protections, activity: [{ id: crypto.randomUUID(), action: "Protection removed · Demo", source: item.sourceLabel, itemCount: 1, timestamp: now(), approvalState: "Not required", executionState: "Completed", resultSummary: "Eligible for future review; no cleanup was scheduled.", itemIds: [itemId] }, ...state.activity] }));
  },
  protectItemsByRule: async (itemIds, criteria, sender) => {
    const items = get().items.filter((item) => itemIds.includes(item.id)); if (!items.length) return;
    const protections = await reviewDemoService.saveProtectionRule(get().protections, items, criteria, sender);
    set((state) => ({ protections, selectedItemIds: state.selectedItemIds.filter((id) => !itemIds.includes(id)), activity: [{ id: crypto.randomUUID(), action: "Protection rule saved · Demo", source: sender ? "Gmail" : [...new Set(items.map((item) => item.sourceLabel))].join(", "), itemCount: items.length, timestamp: now(), approvalState: "Approved", executionState: "Completed", resultSummary: `${criteria}. Matching sample items are excluded from cleanup.`, itemIds }, ...state.activity] }));
  },
  keepItem: (itemId) => set((state) => ({ suggestions: state.suggestions.map((entry) => entry.itemId === itemId ? { ...entry, reviewStatus: "Kept" } : entry) })),
  setSelectedItemIds: (ids) => set({ selectedItemIds: [...new Set(ids)] }),
  toggleSelectedItem: (id) => set((state) => ({ selectedItemIds: state.selectedItemIds.includes(id) ? state.selectedItemIds.filter((itemId) => itemId !== id) : [...state.selectedItemIds, id] })),
  clearSelection: () => set({ selectedItemIds: [] }),
  executeAction: async (action, itemIds, options = {}) => {
    const id = crypto.randomUUID(); const approvedAt = now();
    const pending: ActionPlan = { id, action, itemIds, approvedAt, executionState: "In progress", results: [], attempts: 1, storageRefreshState: action === "cleanup" ? "waiting" : "not-needed", destination: options.destination, conversationId: options.conversationId };
    set((state) => ({ plans: [pending, ...state.plans] }));
    const current = get(); const protectedIds = new Set(current.protections.map((rule) => rule.itemId)); const devices = useDemo.getState().devices;
    const unavailable = itemIds.filter((itemId) => { const item = current.items.find((entry) => entry.id === itemId); return !item || protectedIds.has(itemId) || item.source === "Gmail" && current.connectionStatus.Gmail === "disconnected" || item.source === "Google Drive" && current.connectionStatus["Google Drive"] === "disconnected" || item.source === "Device" && devices.find((device) => device.id === item.sourceId)?.status === "offline"; });
    const available = itemIds.filter((itemId) => !unavailable.includes(itemId));
    const attempted = await reviewDemoService.executeDemoAction(action, available, 1);
    const results = [...attempted, ...unavailable.map((itemId) => ({ itemId, state: "skipped" as const, message: "Skipped because the item became protected or its source is unavailable. Review a revised plan." }))];
    const succeeded = results.filter((result) => result.state === "succeeded").map((result) => result.itemId);
    const failed = results.filter((result) => result.state === "failed").map((result) => result.itemId);
    const skipped = results.filter((result) => result.state === "skipped").map((result) => result.itemId);
    const executionState = failed.length || skipped.length ? (succeeded.length ? "Partially completed" : "Failed") : "Completed";
    const source = [...new Set(get().items.filter((item) => itemIds.includes(item.id)).map((item) => item.sourceLabel))].join(", ");
    set((state) => ({
      plans: state.plans.map((plan) => plan.id === id ? { ...plan, results, executionState } : plan),
      items: action === "organize" && options.destination ? state.items.map((item) => succeeded.includes(item.id) ? { ...item, location: options.destination! } : item) : state.items,
      suggestions: state.suggestions.map((suggestion) => succeeded.includes(suggestion.itemId) ? { ...suggestion, reviewStatus: "Completed" } : failed.includes(suggestion.itemId) ? { ...suggestion, reviewStatus: "Failed" } : suggestion),
      selectedItemIds: state.selectedItemIds.filter((itemId) => !succeeded.includes(itemId)),
      activity: [{ id: crypto.randomUUID(), action: `${action === "cleanup" ? "Cleanup" : "Organization"} action · Demo`, source, itemCount: itemIds.length, timestamp: approvedAt, approvalState: "Approved", executionState, resultSummary: `${succeeded.length} succeeded${failed.length ? `, ${failed.length} failed` : ""}${skipped.length ? `, ${skipped.length} skipped` : ""}.`, itemIds, actionPlanId: id, conversationId: options.conversationId }, ...state.activity],
    }));
    return id;
  },
  retryAction: async (planId) => {
    const plan = get().plans.find((entry) => entry.id === planId); if (!plan) return;
    const failedIds = plan.results.filter((result) => result.state === "failed").map((result) => result.itemId); if (!failedIds.length) return;
    set((state) => ({ plans: state.plans.map((entry) => entry.id === planId ? { ...entry, executionState: "In progress" } : entry) }));
    const retried = await reviewDemoService.executeDemoAction(plan.action, failedIds, plan.attempts + 1);
    const results = [...plan.results.filter((result) => !failedIds.includes(result.itemId)), ...retried];
    const executionState = results.some((result) => result.state === "failed") ? "Partially completed" : "Completed";
    set((state) => ({ plans: state.plans.map((entry) => entry.id === planId ? { ...entry, results, attempts: entry.attempts + 1, executionState } : entry), suggestions: state.suggestions.map((suggestion) => failedIds.includes(suggestion.itemId) ? { ...suggestion, reviewStatus: "Completed" } : suggestion), activity: [{ id: crypto.randomUUID(), action: "Failed items retried · Demo", source: "Previously failed items only", itemCount: failedIds.length, timestamp: now(), approvalState: "Approved", executionState, resultSummary: `${failedIds.length} failed item(s) retried; successful items were not processed again.`, itemIds: failedIds, actionPlanId: planId }, ...state.activity] }));
  },
  updateThreshold: async (settings) => { set({ thresholds: await reviewDemoService.updateThresholds(get().thresholds, settings) }); },
  refreshStorage: async () => {
    const waitingPlans = get().plans.filter((plan) => plan.action === "cleanup" && plan.storageRefreshState === "waiting");
    const successfulIds = waitingPlans.flatMap((plan) => plan.results.filter((result) => result.state === "succeeded").map((result) => result.itemId));
    const cloudRecovered = get().items.filter((item) => successfulIds.includes(item.id) && item.source !== "Device").reduce((sum, item) => sum + (item.recoveryEstimateBytes ?? 0), 0);
    const report = await reviewDemoService.refreshDemoStorageReport(get().report, cloudRecovered);
    set((state) => ({ report, lastRefreshed: report.reportedAt, plans: state.plans.map((plan) => waitingPlans.some((entry) => entry.id === plan.id) ? { ...plan, storageRefreshState: "confirmed" } : plan), activity: [{ id: crypto.randomUUID(), action: "Storage report refreshed · Demo", source: "Google account", itemCount: successfulIds.length, timestamp: now(), approvalState: "Not required", executionState: "Completed", resultSummary: cloudRecovered ? "Confirmed cloud storage change received from the simulated provider report." : "No confirmed cloud storage change was available.", itemIds: successfulIds }, ...state.activity] }));
  },
  toggleConnection: (provider) => {
    const nextConnected = get().connectionStatus[provider] !== "connected";
    const legacy = useDemo.getState();
    if (legacy.connections.includes(provider) !== nextConnected) legacy.connect(provider);
    set((state) => ({ connectionStatus: { ...state.connectionStatus, [provider]: nextConnected ? "connected" : "disconnected" }, activity: [{ id: crypto.randomUUID(), action: `${provider} connection changed · Demo`, source: provider, itemCount: 0, timestamp: now(), approvalState: "Not required", executionState: "Completed", resultSummary: "Only the local demo connection state changed.", itemIds: [] }, ...state.activity] }));
  },
  recordActivity: (event) => set((state) => ({ activity: [{ ...event, id: crypto.randomUUID(), timestamp: now() }, ...state.activity] })),
  resetReviewDemo: () => set(initialReviewState()),
}), { name: "guardrail-review-demo-v1", version: 1, migrate: () => initialReviewState(), skipHydration: true }));
