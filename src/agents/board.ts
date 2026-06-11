import { JsonStore } from "../store/jsonStore.js";

/**
 * The council board — a shared blackboard the whole team writes to during
 * the daily analysis. It turns 14 isolated analyses into team work:
 * specialists post their headline findings as they discover them, every
 * other agent can read the board mid-run (cheaper and broader than pairwise
 * consultations), and the General Manager consolidates from it.
 */

export interface BoardNote {
  agentId: string;
  content: string;
  at: string;
}

interface Board {
  date: string;
  notes: BoardNote[];
}

const store = new JsonStore<Board>("council-board", { date: "", notes: [] });
const MAX_NOTES = 120;

export function resetBoard(date: string): void {
  store.write({ date, notes: [] });
}

export function postNote(agentId: string, content: string): void {
  store.update((b) => ({
    ...b,
    notes: [
      ...b.notes,
      { agentId, content: content.trim().slice(0, 800), at: new Date().toISOString() },
    ].slice(-MAX_NOTES),
  }));
}

export function readBoard(): Board {
  return store.read();
}

/** Formatted board for tool output / GM consolidation. */
export function boardAsText(excludeAgentId?: string): string {
  const board = store.read();
  const notes = board.notes.filter((n) => n.agentId !== excludeAgentId);
  if (notes.length === 0) return "The council board is empty right now.";
  return notes
    .map((n) => `[${n.agentId} @ ${n.at.slice(11, 16)}] ${n.content}`)
    .join("\n");
}
