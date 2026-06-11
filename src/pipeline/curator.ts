import { structuredJson } from "../llm/client.js";
import { AGENTS } from "../agents/definitions.js";
import { memories, MemoryItem } from "../agents/memory.js";
import { JsonStore } from "../store/jsonStore.js";

/**
 * The curator — adopted from Hermes Agent's autonomous maintenance pattern.
 *
 * Agents accumulate memories from daily work and owner feedback. Left alone,
 * memory degrades: duplicates pile up, stale facts contradict new ones, and
 * the prompt budget fills with noise. The curator periodically reviews each
 * agent's memory with the LLM and rewrites it: merging duplicates, dropping
 * superseded or expired items, and tightening wording — never inventing new
 * memories. It runs in the background after a daily analysis when the last
 * curation is older than 7 days.
 */

interface CuratorState {
  lastRunAt: string | null;
  lastSummary: string;
}

const state = new JsonStore<CuratorState>("curator-state", {
  lastRunAt: null,
  lastSummary: "",
});

const memoryStore = new JsonStore<Record<string, MemoryItem[]>>("agent-memory", {});

const INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_MEMORIES_TO_CURATE = 8;

const CURATION_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["lesson", "fact", "feedback"] },
          content: { type: "string" },
        },
        required: ["type", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["memories"],
  additionalProperties: false,
} as const;

async function curateAgent(agentId: string): Promise<string> {
  const items = memories(agentId);
  if (items.length < MIN_MEMORIES_TO_CURATE) return "skipped (few memories)";

  const listing = items
    .map((m) => `- [${m.type} · ${m.createdAt.slice(0, 10)}] ${m.content}`)
    .join("\n");

  const parsed = await structuredJson<{
    memories: { type: MemoryItem["type"]; content: string }[];
  }>(
    `You are curating the long-term memory of an AI department manager for an e-commerce store. Rewrite the memory list below applying these rules strictly:
- MERGE duplicates and near-duplicates into one tighter item.
- DROP items that are superseded by newer items, contradicted, or clearly time-expired (e.g. about a campaign long past).
- KEEP owner feedback about dismissed recommendations — that is the most valuable memory type.
- Tighten wording; one dense sentence per item.
- NEVER invent memories that are not grounded in the list.
- Return at most 40 items, most important first.

Memory of agent "${agentId}":
${listing}`,
    CURATION_SCHEMA as unknown as Record<string, unknown>,
    "memories"
  );

  const cleaned: MemoryItem[] = parsed.memories.slice(0, 40).map((m, i) => ({
    id: `cur${Date.now().toString(36)}${i}`,
    type: ["lesson", "fact", "feedback"].includes(m.type) ? m.type : "fact",
    content: String(m.content).slice(0, 600),
    createdAt: new Date().toISOString(),
  }));
  // Safety valve: a degenerate curation (everything dropped) is rejected.
  if (cleaned.length < Math.min(3, items.length)) return "rejected (degenerate result)";

  memoryStore.update((all) => ({ ...all, [agentId]: cleaned }));
  return `${items.length} → ${cleaned.length} memories`;
}

export function curatorStatus(): CuratorState {
  return state.read();
}

export function curationDue(): boolean {
  const last = state.read().lastRunAt;
  return !last || Date.now() - Date.parse(last) > INTERVAL_MS;
}

export async function runCurator(): Promise<string> {
  const results: string[] = [];
  for (const agent of [...AGENTS.map((a) => a.id), "gm"]) {
    try {
      const outcome = await curateAgent(agent);
      if (!outcome.startsWith("skipped")) results.push(`${agent}: ${outcome}`);
    } catch (err) {
      results.push(`${agent}: failed (${(err as Error).message})`);
    }
  }
  const summary = results.length ? results.join("; ") : "nothing to curate";
  state.write({ lastRunAt: new Date().toISOString(), lastSummary: summary });
  console.log(`[curator] ${summary}`);
  return summary;
}
