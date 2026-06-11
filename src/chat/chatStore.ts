import { JsonStore } from "../store/jsonStore.js";
import { Turn } from "../agents/runner.js";

type Histories = Record<string, Turn[]>; // agentId -> turns

const store = new JsonStore<Histories>("chat-history", {});
const MAX_TURNS = 40; // keep the last 20 exchanges per agent

export function getHistory(agentId: string): Turn[] {
  return store.read()[agentId] ?? [];
}

export function appendExchange(agentId: string, user: string, assistant: string): void {
  store.update((h) => ({
    ...h,
    [agentId]: [
      ...(h[agentId] ?? []),
      { role: "user" as const, content: user },
      { role: "assistant" as const, content: assistant },
    ].slice(-MAX_TURNS),
  }));
}

export function clearHistory(agentId: string): void {
  store.update((h) => ({ ...h, [agentId]: [] }));
}
