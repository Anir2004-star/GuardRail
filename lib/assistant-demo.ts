import { ActionKind, StorageItem } from "./review-demo";

export type AssistantScope = "all" | "gmail" | "drive" | `device:${string}`;
export type ChatMessageType = "user" | "explanation" | "search-results" | "recommendation" | "clarification" | "action-preview" | "action-result" | "error";

export type AssistantActionPreview = {
  action: ActionKind | "protect";
  itemIds: string[];
  destination?: string;
  criteria?: string;
  sender?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  type: ChatMessageType;
  text: string;
  createdAt: string;
  itemIds?: string[];
  appliedFilters?: string[];
  excludedProtectedCount?: number;
  quickReplies?: string[];
  actionPreview?: AssistantActionPreview;
  actionPlanId?: string;
  effect?: { kind: "keep"; itemIds: string[] };
};

export type Conversation = {
  id: string;
  title: string;
  scope: AssistantScope;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type AssistantRequest = {
  text: string;
  scope: AssistantScope;
  items: StorageItem[];
  protectedItemIds: string[];
  previousItemIds?: string[];
};

export type AssistantResponse = {
  progressLabel: string;
  message: Omit<ChatMessage, "id" | "createdAt">;
};

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); }, { once: true });
});

const inScope = (item: StorageItem, scope: AssistantScope) => scope === "all"
  || scope === "gmail" && item.source === "Gmail"
  || scope === "drive" && item.source === "Google Drive"
  || scope.startsWith("device:") && item.sourceId === scope.slice(7);

const response = (type: ChatMessageType, text: string, extra: Partial<AssistantResponse["message"]> = {}): AssistantResponse["message"] => ({
  role: "assistant", type, text, ...extra,
});

export function assistantProgressLabel(text: string, scope: AssistantScope) {
  const query = text.toLowerCase();
  if (query.includes("protect") || query.includes("always keep")) return "Checking protected items";
  if (query.includes("organize") || query.includes("group") || query.includes("label")) return "Preparing action preview";
  if (scope === "gmail" || query.includes("email")) return "Searching sample Gmail items";
  if (scope === "drive") return "Searching sample Google Drive items";
  if (scope.startsWith("device:")) return "Searching cached sample device items";
  return "Searching connected sample sources";
}

export async function sendDemoAssistantMessage(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
  const query = request.text.trim().toLowerCase();
  const progressLabel = assistantProgressLabel(query, request.scope);
  await wait(720, signal);
  const scoped = request.items.filter((item) => inScope(item, request.scope));
  const protectedSet = new Set(request.protectedItemIds);
  const previous = scoped.filter((item) => request.previousItemIds?.includes(item.id));

  if (/clean everything|delete old files|delete everything/.test(query)) {
    return { progressLabel, message: response("clarification", "Which source should I review, and what should count as old? Nothing has been selected or changed.", { quickReplies: ["Find files larger than 1 GB in Downloads", "Find older promotional emails, but keep bills", "Suggest ways to free space"] }) };
  }
  if (query.includes("important email") && !query.includes("sender")) {
    return { progressLabel, message: response("clarification", "How would you like to define important emails? Choose a sender, an existing label, or explicit items. This demo cannot identify importance perfectly.", { quickReplies: ["Protect emails from registrar@college-demo.test", "Show college-related emails"] }) };
  }
  if (query.includes("will moving") || query.includes("trash free") || query.includes("free storage immediately")) {
    return { progressLabel, message: response("explanation", "Moving an item to Trash may not reduce reported storage immediately. Items in Trash can still count toward quota until the source reports a later change. Guardrail keeps selected size, estimated recovery, and confirmed storage change separate.") };
  }
  if (query.includes("why did you suggest")) {
    const item = previous[0];
    return { progressLabel, message: item ? response("explanation", `${item.name} was shown because ${item.reason.toLowerCase()} Its source is ${item.sourceLabel}, and the proposed action still requires your review.`, { itemIds: [item.id] }) : response("clarification", "Open or search for an item first, then ask why it was suggested.") };
  }
  if (query.includes("keep the second")) {
    const item = previous[1];
    return { progressLabel, message: item ? response("explanation", `${item.name} is now marked Keep for now. This only updates the local demo review state.`, { itemIds: [item.id], effect: { kind: "keep", itemIds: [item.id] } }) : response("clarification", "I cannot resolve “the second file” from the current result set. Please run a search again or name the item.") };
  }
  if (query.includes("older than one year")) {
    const matches = previous.filter((item) => new Date(item.relevantDate) < new Date("2025-10-16T00:00:00.000Z"));
    return { progressLabel, message: response("search-results", `Refined the current results to ${matches.length} item${matches.length === 1 ? "" : "s"} older than one year. Age is only a filter, not evidence that an item is unnecessary.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Previous result set", "Relevant date before 16 Oct 2025"] }) };
  }
  if (query.includes("exclude pdf")) {
    const matches = previous.filter((item) => !item.name.toLowerCase().endsWith(".pdf"));
    return { progressLabel, message: response("search-results", `Refined the current results to ${matches.length} non-PDF item${matches.length === 1 ? "" : "s"}.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Previous result set", "File name does not end in .pdf"] }) };
  }
  if (query.includes("protect") || query.includes("always keep")) {
    const sender = query.includes("college") || query.includes("registrar") ? "registrar@college-demo.test" : scoped.find((item) => item.sender)?.sender;
    const matches = sender ? scoped.filter((item) => item.sender === sender) : scoped.filter((item) => item.category === "Project document");
    if (!matches.length) return { progressLabel, message: response("clarification", "Which sender, folder, or exact items should be protected?", { quickReplies: ["Protect emails from registrar@college-demo.test", "Protect my project documents"] }) };
    const criteria = sender ? `Sender is ${sender}` : "Project documents in this demo workspace";
    return { progressLabel, message: response("action-preview", `Protection rule preview: ${criteria}. It currently matches ${matches.length} sample item${matches.length === 1 ? "" : "s"} and will exclude them from cleanup recommendations.`, { itemIds: matches.map((item) => item.id), actionPreview: { action: "protect", itemIds: matches.map((item) => item.id), criteria, sender } }) };
  }
  if (query.includes("group") && query.includes("project") || query.includes("organize project")) {
    const matches = scoped.filter((item) => item.category === "Project document");
    return { progressLabel, message: response("action-preview", `Found ${matches.length} related project documents. Review moving them from their current locations to /Projects/Guardrail. Organization does not free storage.`, { itemIds: matches.map((item) => item.id), actionPreview: { action: "organize", itemIds: matches.map((item) => item.id), destination: "/Projects/Guardrail" } }) };
  }
  if (query.includes("label") && query.includes("college")) {
    const matches = scoped.filter((item) => item.category === "College email");
    return { progressLabel, message: response("action-preview", `Found ${matches.length} college-related sample email. Review applying the Gmail label “College”. A label changes organization and does not duplicate the message or free storage.`, { itemIds: matches.map((item) => item.id), actionPreview: { action: "organize", itemIds: matches.map((item) => item.id), destination: "Gmail label: College" } }) };
  }
  if (query.includes("offline") || query.includes("cached")) {
    const matches = scoped.filter((item) => item.sourceId === "gr-device-tablet");
    return { progressLabel, message: response("search-results", `Found ${matches.length} cached item from College iPad. The device is offline, so this information may be outdated and execution is unavailable.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["College iPad", "Cached sample metadata", "Offline source"] }) };
  }
  if (((query.includes("email") && (query.includes("10 mb") || query.includes("large"))) || query === "find large emails") && !query.includes("promotional")) {
    const matches = scoped.filter((item) => item.kind === "email" && item.sizeBytes > 10_000_000);
    return { progressLabel, message: response("search-results", `Found ${matches.length} sample emails larger than 10 MB. No items are selected by default.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Gmail", "Email size greater than 10 MB"], excludedProtectedCount: matches.filter((item) => protectedSet.has(item.id)).length }) };
  }
  if ((query.includes("1 gb") || query.includes("large file")) && query.includes("download")) {
    const matches = scoped.filter((item) => item.kind !== "email" && item.sizeBytes > 1_000_000_000 && item.location.toLowerCase().includes("download"));
    return { progressLabel, message: response("search-results", `Found ${matches.length} sample files larger than 1 GB in permitted Downloads locations. Check each item before deciding; old or large does not mean unnecessary.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Size greater than 1 GB", "Path contains Downloads"], excludedProtectedCount: matches.filter((item) => protectedSet.has(item.id)).length }) };
  }
  if (query.includes("old download") || query.includes("review old downloads")) {
    const matches = scoped.filter((item) => item.location.toLowerCase().includes("download") && new Date(item.relevantDate) < new Date("2026-04-16T00:00:00.000Z"));
    return { progressLabel, message: response("recommendation", `Found ${matches.length} older sample downloads. Their dates are a review signal only; confirm whether each is still needed.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Downloads locations", "Older than six months"] }) };
  }
  if (query.includes("promotional")) {
    const matches = scoped.filter((item) => item.location === "Promotions");
    return { progressLabel, message: response("recommendation", `Found ${matches.length} older promotional email. Bills and protected items were not included. Review the sender and full message before moving anything to Trash.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Gmail Promotions", "Older sample messages", "Exclude protected items"], excludedProtectedCount: request.protectedItemIds.length }) };
  }
  if (query.includes("college") && query.includes("email")) {
    const matches = scoped.filter((item) => item.category === "College email");
    return { progressLabel, message: response("search-results", `Found ${matches.length} college-related sample email. The category comes from the fixed demo dataset; Guardrail has not inferred importance.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Gmail", "Sample category: College email"] }) };
  }
  if (query.includes("free space") || query.includes("storage recommendation") || query.includes("reduce my google")) {
    const matches = scoped.filter((item) => !protectedSet.has(item.id) && item.recoveryEstimateBytes !== 0).slice(0, 6);
    return { progressLabel, message: response("recommendation", `Found ${matches.length} review candidates across the selected scope. These are suggestions, not items declared safe to delete. Select exact items before preparing a cleanup preview.`, { itemIds: matches.map((item) => item.id), appliedFilters: ["Current scope", "Exclude protected items"], excludedProtectedCount: scoped.filter((item) => protectedSet.has(item.id)).length }) };
  }
  return { progressLabel, message: response("explanation", "This demo supports finding items, reviewing cleanup suggestions, organizing sample items, and protecting items.", { quickReplies: ["Find emails larger than 10 MB", "Show files larger than 1 GB in Downloads", "Group my project documents into folders", "Suggest ways to free space"] }) };
}

export const assistantSuggestedPrompts = [
  "Find emails larger than 10 MB",
  "Show files larger than 1 GB in Downloads",
  "Group my project documents into folders",
  "Protect emails from registrar@college-demo.test",
  "Suggest ways to free space",
];

export const initialConversation = (): Conversation => {
  const timestamp = "2026-10-16T03:30:00.000Z";
  return {
    id: "conversation-welcome",
    title: "Welcome to Guardrail",
    scope: "all",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [{
      id: "message-welcome",
      role: "assistant",
      type: "explanation",
      text: "Demo assistant: responses use sample data. No real accounts or files are accessed. Ask me to find, organize, protect, or review sample items.",
      createdAt: timestamp,
    }],
  };
};
