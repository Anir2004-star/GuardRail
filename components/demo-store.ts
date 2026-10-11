"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { demoService, seedItems, seedDevices, defaultPreferences, Device, Preferences, Item, proposals } from "@/lib/demo-service";
export { proposals, protectionReason, demoService, instructions } from "@/lib/demo-service";
export type { Item, Device } from "@/lib/demo-service";
export type Execution = { id: string; proposalId: string; ids: string[]; action: string; state: "approved" | "completed"; created: string };
type Event = { id: string; text: string; time: string; type: "content" | "sync" | "execution" | "account" | "device" };
type DemoState = {
  items: Item[]; devices: Device[]; connections: string[]; executions: Execution[]; events: Event[]; readNotifications: string[];
  profile: { name: string; email: string }; preferences: Preferences; lastSync: string | null;
  registerDevice: (device: Omit<Device, "id" | "updated">) => void; updateDevice: (id: string, device: Omit<Device, "id" | "updated">) => void;
  toggleProtection: (id: string) => void; organize: (ids: string[], folder: string) => void; restore: (id: string) => void;
  connect: (provider: string) => void; scan: () => void; approve: (proposalId: string, ids: string[], action: string) => string;
  execute: (id: string) => string | null; markRead: (ids: string[]) => void;
  saveSettings: (profile: DemoState["profile"], preferences: DemoState["preferences"]) => void;
};
const stamp = () => new Date().toISOString();
const event = (text: string, type: Event["type"]): Event => ({ id: crypto.randomUUID(), text, time: stamp(), type });

export const useDemo = create<DemoState>()(persist((set, get) => ({
  items: seedItems, devices: seedDevices, connections: ["Gmail", "Google Drive"], executions: [], events: [], readNotifications: [],
  profile: { name: "Anirban", email: "" }, preferences: defaultPreferences, lastSync: null,
  registerDevice: (device) => set((s) => ({ devices: [...s.devices, { ...device, id: "gr-device-" + crypto.randomUUID(), updated: stamp() }], events: [event("Registered sample device: " + device.name, "device"), ...s.events] })),
  updateDevice: (id, device) => set((s) => ({ devices: s.devices.map((d) => d.id === id ? { ...device, id, updated: stamp() } : d), events: [event("Updated sample device: " + device.name, "device"), ...s.events] })),
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
}), { name: "guardrail-frontend-demo-v1", version: 2, migrate: () => ({ items: seedItems, devices: seedDevices, connections: ["Gmail", "Google Drive"], executions: [], events: [], readNotifications: [], profile: { name: "Anirban", email: "" }, preferences: defaultPreferences, lastSync: null }), skipHydration: true }));
export const formatSize = (mb: number) => mb >= 1000 ? `${Number((mb / 1000).toFixed(3))} GB` : `${mb} MB`;
export const notifications = [
  { id: "review", title: "Recommendations ready for review", text: "Three sample proposals explain possible cleanup and organization actions.", href: "/app/proposals" },
  { id: "sync", title: "Your demo workspace is ready", text: "Explore sample Gmail and Drive content without accessing a real account.", href: "/app/connections" },
];
