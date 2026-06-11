import crypto from "node:crypto";
import { JsonStore } from "../store/jsonStore.js";
import { sallaWrite } from "../salla/client.js";
import { remember } from "../agents/memory.js";

/**
 * Change requests — the write-mode machinery.
 *
 * read_only: this module is never reached.
 * confirm:   agents file a ChangeRequest (status "pending"); the owner
 *            approves or rejects from the dashboard. Approval executes the
 *            write; rejection feeds the agent's memory so it learns.
 * auto:      the change executes immediately and is journaled as "applied"
 *            with decidedBy "auto".
 *
 * Everything — pending, applied, failed, rejected — stays in one journal:
 * a complete audit trail of every write any agent ever attempted.
 */

export type ChangeStatus = "pending" | "applied" | "rejected" | "failed";

export interface ChangeRequest {
  id: string;
  agentId: string;
  method: "POST" | "PUT";
  endpoint: string;
  payload: Record<string, unknown>;
  /** Agent's human-readable summary of what this change does and why. */
  description: string;
  status: ChangeStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: "owner" | "auto";
  rejectReason?: string;
  /** Salla response (status code) or error message. */
  result?: string;
}

const store = new JsonStore<ChangeRequest[]>("change-requests", []);
const MAX_JOURNAL = 300;
const MAX_PENDING_PER_AGENT = 10;

function save(change: ChangeRequest): void {
  store.update((all) => [change, ...all].slice(0, MAX_JOURNAL));
}

function patch(id: string, fields: Partial<ChangeRequest>): ChangeRequest | undefined {
  let updated: ChangeRequest | undefined;
  store.update((all) =>
    all.map((c) => {
      if (c.id !== id) return c;
      updated = { ...c, ...fields };
      return updated;
    })
  );
  return updated;
}

async function execute(change: ChangeRequest, decidedBy: "owner" | "auto"): Promise<ChangeRequest> {
  try {
    const { status } = await sallaWrite(change.method, change.endpoint, change.payload);
    return (
      patch(change.id, {
        status: "applied",
        decidedAt: new Date().toISOString(),
        decidedBy,
        result: `HTTP ${status}`,
      }) ?? change
    );
  } catch (err) {
    return (
      patch(change.id, {
        status: "failed",
        decidedAt: new Date().toISOString(),
        decidedBy,
        result: (err as Error).message.slice(0, 400),
      }) ?? change
    );
  }
}

/** Called by the salla_write tool. Returns a message for the agent. */
export async function requestChange(
  agentId: string,
  mode: "confirm" | "auto",
  method: "POST" | "PUT",
  endpoint: string,
  payload: Record<string, unknown>,
  description: string
): Promise<string> {
  const pendingCount = store
    .read()
    .filter((c) => c.agentId === agentId && c.status === "pending").length;
  if (mode === "confirm" && pendingCount >= MAX_PENDING_PER_AGENT) {
    return `You already have ${pendingCount} changes awaiting the owner's approval — don't queue more until they decide.`;
  }

  const change: ChangeRequest = {
    id: crypto.randomBytes(6).toString("hex"),
    agentId,
    method,
    endpoint: endpoint.replace(/^\/+|\/+$/g, ""),
    payload,
    description: description.trim().slice(0, 500),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  save(change);

  if (mode === "auto") {
    const done = await execute(change, "auto");
    return done.status === "applied"
      ? `Change applied to the store (${done.result}). It is recorded in the change journal.`
      : `Change FAILED: ${done.result}. Not applied.`;
  }
  return `Change queued for the owner's approval (id ${change.id}). Do NOT claim it is live — tell the owner it awaits their confirmation on the dashboard.`;
}

export async function approveChange(id: string): Promise<ChangeRequest | undefined> {
  const change = store.read().find((c) => c.id === id && c.status === "pending");
  if (!change) return undefined;
  const done = await execute(change, "owner");
  remember(
    change.agentId,
    "feedback",
    `The owner APPROVED and applied my change: "${change.description}" (${done.status === "applied" ? "succeeded" : "failed: " + done.result}).`
  );
  return done;
}

export function rejectChange(id: string, reason: string): ChangeRequest | undefined {
  const change = store.read().find((c) => c.id === id && c.status === "pending");
  if (!change) return undefined;
  const updated = patch(id, {
    status: "rejected",
    decidedAt: new Date().toISOString(),
    decidedBy: "owner",
    rejectReason: reason.trim().slice(0, 300),
  });
  remember(
    change.agentId,
    "feedback",
    `The owner REJECTED my proposed change: "${change.description}"${reason ? ` — reason: ${reason}` : ""}. Don't re-propose it as-is.`
  );
  return updated;
}

export function listChanges(status?: ChangeStatus): ChangeRequest[] {
  const all = store.read();
  return status ? all.filter((c) => c.status === status) : all;
}
