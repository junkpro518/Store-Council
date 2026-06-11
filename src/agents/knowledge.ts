import crypto from "node:crypto";
import { JsonStore } from "../store/jsonStore.js";

/**
 * Per-agent knowledge base — owner-provided documents beyond store data:
 * supplier price lists and lead times, brand guidelines, policy details,
 * ad-account exports, market notes. Distinct from memory: memory is what the
 * AGENT learns (auto-accumulated, curator-managed); knowledge is what the
 * OWNER provides (manual, stable, never curated away).
 *
 * The pseudo-agent id "all" holds documents every manager can read.
 */

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

const store = new JsonStore<Record<string, KnowledgeDoc[]>>("knowledge", {});

const MAX_DOCS_PER_AGENT = 30;
const MAX_CONTENT_CHARS = 20_000;

export function addDoc(agentId: string, title: string, content: string): KnowledgeDoc {
  const docs = store.read()[agentId] ?? [];
  if (docs.length >= MAX_DOCS_PER_AGENT) {
    throw new Error(`Knowledge base for "${agentId}" is full (${MAX_DOCS_PER_AGENT} docs).`);
  }
  const doc: KnowledgeDoc = {
    id: crypto.randomBytes(6).toString("hex"),
    title: title.trim().slice(0, 120),
    content: content.slice(0, MAX_CONTENT_CHARS),
    updatedAt: new Date().toISOString(),
  };
  if (!doc.title || !doc.content.trim()) throw new Error("Title and content are required.");
  store.update((all) => ({ ...all, [agentId]: [...(all[agentId] ?? []), doc] }));
  return doc;
}

export function updateDoc(
  agentId: string,
  docId: string,
  fields: { title?: string; content?: string }
): KnowledgeDoc | undefined {
  let updated: KnowledgeDoc | undefined;
  store.update((all) => ({
    ...all,
    [agentId]: (all[agentId] ?? []).map((d) => {
      if (d.id !== docId) return d;
      updated = {
        ...d,
        ...(fields.title !== undefined ? { title: fields.title.trim().slice(0, 120) } : {}),
        ...(fields.content !== undefined ? { content: fields.content.slice(0, MAX_CONTENT_CHARS) } : {}),
        updatedAt: new Date().toISOString(),
      };
      return updated;
    }),
  }));
  return updated;
}

export function deleteDoc(agentId: string, docId: string): boolean {
  let removed = false;
  store.update((all) => {
    const docs = all[agentId] ?? [];
    const next = docs.filter((d) => d.id !== docId);
    removed = next.length !== docs.length;
    return { ...all, [agentId]: next };
  });
  return removed;
}

export function listDocs(agentId: string): KnowledgeDoc[] {
  return store.read()[agentId] ?? [];
}

/** Documents visible to an agent: its own plus the shared "all" bucket. */
export function visibleDocs(agentId: string): { scope: "own" | "shared"; doc: KnowledgeDoc }[] {
  return [
    ...listDocs(agentId).map((doc) => ({ scope: "own" as const, doc })),
    ...listDocs("all").map((doc) => ({ scope: "shared" as const, doc })),
  ];
}

export function getVisibleDoc(agentId: string, docId: string): KnowledgeDoc | undefined {
  return visibleDocs(agentId).find((v) => v.doc.id === docId)?.doc;
}

/** Prompt index block (titles only — content loads via the knowledge_base tool). */
export function knowledgePromptBlock(agentId: string): string {
  const docs = visibleDocs(agentId);
  if (docs.length === 0) return "";
  return `## Your knowledge base (documents the owner provided — read with knowledge_base before relying on assumptions in their area)
${docs.map((v) => `- [${v.doc.id}] ${v.doc.title}${v.scope === "shared" ? " (shared)" : ""}`).join("\n")}`;
}
