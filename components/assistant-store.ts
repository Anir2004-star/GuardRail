"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AssistantScope, ChatMessage, Conversation, initialConversation } from "@/lib/assistant-demo";

type AssistantState = {
  conversations: Conversation[];
  activeConversationId: string;
  createConversation: (scope?: AssistantScope) => string;
  selectConversation: (id: string) => void;
  setScope: (id: string, scope: AssistantScope) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  renameFromPrompt: (conversationId: string, prompt: string) => void;
  resetAssistant: () => void;
};

const initialState = () => ({ conversations: [initialConversation()], activeConversationId: "conversation-welcome" });

export const useAssistantDemo = create<AssistantState>()(persist((set) => ({
  ...initialState(),
  createConversation: (scope = "all") => {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const conversation: Conversation = {
      id, title: "New conversation", scope, createdAt: timestamp, updatedAt: timestamp,
      messages: [{ id: crypto.randomUUID(), role: "assistant", type: "explanation", createdAt: timestamp, text: "Demo assistant: responses use sample data. No real accounts or files are accessed." }],
    };
    set((state) => ({ conversations: [conversation, ...state.conversations], activeConversationId: id }));
    return id;
  },
  selectConversation: (id) => set({ activeConversationId: id }),
  setScope: (id, scope) => set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === id ? { ...conversation, scope, updatedAt: new Date().toISOString() } : conversation) })),
  addMessage: (conversationId, message) => set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: [...conversation.messages, message], updatedAt: message.createdAt } : conversation) })),
  renameFromPrompt: (conversationId, prompt) => set((state) => ({ conversations: state.conversations.map((conversation) => conversation.id === conversationId && conversation.title === "New conversation" ? { ...conversation, title: prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt } : conversation) })),
  resetAssistant: () => set(initialState()),
}), { name: "guardrail-assistant-demo-v1", version: 1, migrate: () => initialState(), skipHydration: true }));
