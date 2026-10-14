"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ActivityEvent, defaultPreferences, demoService, Device, deviceService, Item, PairingSession, Preferences, proposals, seedDevices, seedItems } from "@/lib/demo-service";

export { proposals, protectionReason, demoService, deviceService, formatDemoDateTime, instructions } from "@/lib/demo-service";
export type { ActivityEvent, CleanupCandidate, Device, DevicePermission, DeviceType, Item, PairingSession, StorageSummary } from "@/lib/demo-service";
export type Execution = { id: string; proposalId: string; ids: string[]; action: string; state: "approved" | "completed"; created: string };

type DemoState = {
  items: Item[]; devices: Device[]; connections: string[]; executions: Execution[]; events: ActivityEvent[]; readNotifications: string[];
  profile: { name: string; email: string }; preferences: Preferences; lastSync: string | null;
  confirmDemoDeviceConnection: (session: PairingSession) => Promise<string>;
  renameDevice: (id: string, name: string) => Promise<string | null>;
  disconnectDevice: (id: string) => Promise<void>;
  simulatePermission: (deviceId: string, permissionId: string) => Promise<void>;
  keepCleanupCandidate: (deviceId: string, candidateId: string) => Promise<void>;
  simulateCleanup: (deviceId: string, candidateIds: string[]) => Promise<void>;
  resetDemoData: () => void;
  toggleProtection: (id: string) => void; organize: (ids: string[], folder: string) => void; restore: (id: string) => void;
  connect: (provider: string) => void; scan: () => void; approve: (proposalId: string, ids: string[], action: string) => string;
  execute: (id: string) => string | null; markRead: (ids: string[]) => void;
  saveSettings: (profile: DemoState["profile"], preferences: DemoState["preferences"]) => void;
};
const stamp = () => new Date().toISOString();
const event = (text: string, type: ActivityEvent["type"]): ActivityEvent => ({ id: crypto.randomUUID(), text, time: stamp(), type });
const initialData = () => ({
  items: seedItems,
  devices: seedDevices,
  connections: ["Gmail", "Google Drive"],
  executions: [] as Execution[],
  events: [] as ActivityEvent[],
  readNotifications: [] as string[],
  profile: { name: "Anirban", email: "" },
  preferences: defaultPreferences,
  lastSync: null as string | null,
});

export const useDemo = create<DemoState>()(persist((set, get) => ({
  ...initialData(),
  confirmDemoDeviceConnection: async (session) => {
    const next = await deviceService.confirmDemoDeviceConnection(get().devices, session);
    const device = next.at(-1)!;
    set((state) => ({ devices: next, events: [event(`Connected demo device: ${device.name}`, "device"), ...state.events] }));
    return device.id;
  },
  renameDevice: async (id, name) => {
    try {
      const devices = await deviceService.renameDevice(get().devices, id, name);
      set((state) => ({ devices, events: [event(`Renamed demo device to ${name.trim()}`, "device"), ...state.events] }));
      return null;
    } catch (error) { return error instanceof Error ? error.message : "Unable to rename this demo device."; }
  },
  disconnectDevice: async (id) => {
    const current = get().devices.find((device) => device.id === id);
    const devices = await deviceService.disconnectDevice(get().devices, id);
    set((state) => ({ devices, events: [event(`Disconnected demo device: ${current?.name ?? "Unknown device"}`, "device"), ...state.events] }));
  },
  simulatePermission: async (deviceId, permissionId) => { set({ devices: await deviceService.simulatePermission(get().devices, deviceId, permissionId) }); },
  keepCleanupCandidate: async (deviceId, candidateId) => { set({ devices: await deviceService.keepCleanupCandidate(get().devices, deviceId, candidateId) }); },
  simulateCleanup: async (deviceId, candidateIds) => {
    const devices = await deviceService.simulateCleanup(get().devices, deviceId, candidateIds);
    set((state) => ({ devices, events: [event(`Simulated moving ${candidateIds.length} device file(s) to Trash`, "device"), ...state.events] }));
  },
  resetDemoData: () => set(initialData()),
  toggleProtection: (id) => set((s) => ({ items: demoService.toggleProtection(s.items, id), events: [event("Updated item protection", "content"), ...s.events] })),
  organize: (ids, folder) => set((s) => ({ items: demoService.organize(s.items, ids, folder), events: [event(`Organized ${ids.length} sample item(s) into ${folder}`, "content"), ...s.events] })),
  restore: (id) => set((s) => ({ items: demoService.restore(s.items, id), events: [event("Restored a sample item", "content"), ...s.events] })),
  connect: (provider) => set((s) => ({ connections: s.connections.includes(provider) ? s.connections.filter((p) => p !== provider) : [...s.connections, provider], events: [event(`Updated ${provider} demo connection`, "account"), ...s.events] })),
  scan: () => set((s) => ({ lastSync: stamp(), events: [event("Demo scan completed; sample index refreshed", "sync"), ...s.events] })),
  approve: (proposalId, ids, action) => {
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.action !== action || !ids.length || ids.some((id) => !(proposal.ids as readonly string[]).includes(id))) return "";
    const items = get().items.filter((i) => ids.includes(i.id));
    if (items.length !== ids.length || items.some((i) => !demoService.eligible(i, get().preferences, get().connections))) return "";
    const id = crypto.randomUUID();
    set((s) => ({ executions: [{ id, proposalId, ids: [...ids], action, state: "approved", created: stamp() }, ...s.executions], events: [event(`Approved ${ids.length} sample item(s)`, "execution"), ...s.events] }));
    return id;
  },
  execute: (id) => {
    const s = get(); const run = s.executions.find((e) => e.id === id);
    if (!run || run.state !== "approved") return "This demo execution is no longer awaiting execution.";
    const items = s.items.filter((i) => run.ids.includes(i.id));
    if (items.length !== run.ids.length || items.some((i) => !demoService.eligible(i, s.preferences, s.connections))) return "An item is protected, unavailable, or disconnected. Review a new proposal before executing.";
    if (Date.now() - new Date(run.created).getTime() > 15 * 60 * 1000) return "This demo approval expired. Return to the recommendation and review again.";
    set({ items: demoService.execute(s.items, run.ids, run.action), executions: s.executions.map((e) => e.id === id ? { ...e, state: "completed" } : e), events: [event(`Completed mock ${run.action} for ${run.ids.length} item(s)`, "execution"), ...s.events] });
    return null;
  },
  markRead: (ids) => set((s) => ({ readNotifications: [...new Set([...s.readNotifications, ...ids])] })),
  saveSettings: (profile, preferences) => set((s) => ({ profile, preferences, events: [event("Saved workspace preferences", "account"), ...s.events] })),
}), { name: "guardrail-frontend-demo-v1", version: 3, migrate: () => initialData(), skipHydration: true }));

export const formatSize = (mb: number) => mb >= 1000 ? `${Number((mb / 1000).toFixed(3))} GB` : `${mb} MB`;
export const notifications = [
  { id: "review", title: "Recommendations ready for review", text: "Three sample proposals explain possible cleanup and organization actions.", href: "/app/proposals" },
  { id: "sync", title: "Your demo workspace is ready", text: "Explore sample Gmail and Drive content without accessing a real account.", href: "/app/connections" },
];
