"use client";

import { create } from "zustand";
import type { LoginSession } from "@/lib/login-api";

// Tokens/profile remain in memory; the coordinator restores them via the cookie.
export const useAuthSession = create<{
  session: LoginSession | null;
  status: "idle" | "restoring" | "ready" | "anonymous" | "paused" | "logging-out" | "logout-failed" | "signed-out";
  message: string;
  setSession: (session: LoginSession) => void;
  clearSession: () => void;
}>((set) => ({
  session: null,
  status: "idle",
  message: "",
  setSession: (session) => set({ session, status: "ready", message: "" }),
  clearSession: () => set({ session: null, status: "anonymous", message: "" }),
}));
