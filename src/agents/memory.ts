import crypto from "node:crypto";
import { JsonStore } from "../store/jsonStore.js";

/**
 * Per-agent long-term memory — the platform's learning system.
 *
 * Memories accumulate from three sources:
 *  - "lesson":   the agent itself records what it learned (via save_memory)
 *  - "feedback": automatic — when the owner marks an action done/dismissed,
 *                the owning agent is told, so it stops repeating rejected
 *                advice and doubles down on what the owner values
 *  - "fact":     durable store facts the agent discovered (supplier lead
 *                times, the owner's constraints, seasonal patterns...)
 *
 * Recent memories are injected into the agent's system prompt, closing the
 * loop: every conversation and daily analysis starts from accumulated
 * experience instead of a blank slate.
 */

export type MemoryType = "lesson" | "fact" | "feedback";

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  createdAt: string;
}

const store = new JsonStore<Record<string, MemoryItem[]>>("agent-memory", {});

const MAX_PER_AGENT = 60;
const PROMPT_BUDGET = 20; // newest items injected into the system prompt

export function remember(agentId: string, type: MemoryType, content: string): MemoryItem {
  const item: MemoryItem = {
    id: crypto.randomBytes(6).toString("hex"),
    type,
    content: content.trim().slice(0, 600),
    createdAt: new Date().toISOString(),
  };
  store.update((all) => ({
    ...all,
    [agentId]: [item, ...(all[agentId] ?? [])].slice(0, MAX_PER_AGENT),
  }));
  return item;
}

export function memories(agentId: string): MemoryItem[] {
  return store.read()[agentId] ?? [];
}

export function forget(agentId: string, memoryId: string): boolean {
  let removed = false;
  store.update((all) => {
    const list = all[agentId] ?? [];
    const next = list.filter((m) => m.id !== memoryId);
    removed = next.length !== list.length;
    return { ...all, [agentId]: next };
  });
  return removed;
}

/** Markdown block for the system prompt (empty string when no memories). */
export function memoryPromptBlock(agentId: string): string {
  const items = memories(agentId).slice(0, PROMPT_BUDGET);
  if (items.length === 0) return "";
  const lines = items.map(
    (m) => `- [${m.type} · ${m.createdAt.slice(0, 10)}] ${m.content}`
  );
  return `## Your memory (lessons, facts, and owner feedback you accumulated)
Apply these — do not repeat advice the owner rejected, and build on what worked:
${lines.join("\n")}`;
}
