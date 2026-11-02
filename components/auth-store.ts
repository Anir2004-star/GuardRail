"use client";

import { create } from "zustand";
import type { LoginSession } from "@/lib/login-api";

// Deliberately no persist/devtools middleware or browser storage. A page reload
// clears this state; cookie-based session restoration is a separate milestone.
export const useAuthSession = create<{
  session: LoginSession | null;
  setSession: (session: LoginSession) => void;
  clearSession: () => void;
}>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
}));
