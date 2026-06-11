import crypto from "node:crypto";
import { JsonStore } from "../store/jsonStore.js";
import { remember } from "./memory.js";

/**
 * Owner questions — the discussion channel for autonomous work. When a
 * manager hits a decision or missing fact only the owner can resolve (during
 * a daily analysis especially), it asks instead of guessing. Questions queue
 * in a dashboard inbox; the owner's answer is written into the manager's
 * memory as owner-provided fact.
 */

export type QuestionStatus = "pending" | "answered" | "dismissed";

export interface OwnerQuestion {
  id: string;
  agentId: string;
  question: string;
  context: string;
  status: QuestionStatus;
  createdAt: string;
  answer?: string;
  answeredAt?: string;
}

const store = new JsonStore<OwnerQuestion[]>("owner-questions", []);
const MAX_PENDING_PER_AGENT = 5;
const MAX_TOTAL = 200;

export function askOwner(agentId: string, question: string, context: string): string {
  const pending = store.read().filter((q) => q.agentId === agentId && q.status === "pending");
  if (pending.length >= MAX_PENDING_PER_AGENT) {
    return `You already have ${pending.length} unanswered questions — work with explicit assumptions for now and state them in your findings.`;
  }
  const q: OwnerQuestion = {
    id: crypto.randomBytes(6).toString("hex"),
    agentId,
    question: question.trim().slice(0, 500),
    context: context.trim().slice(0, 500),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  store.update((all) => [q, ...all].slice(0, MAX_TOTAL));
  return "Question sent to the owner's inbox. Until answered, proceed with your best explicit assumption and label it as such.";
}

export function answerQuestion(id: string, answer: string): OwnerQuestion | undefined {
  let updated: OwnerQuestion | undefined;
  store.update((all) =>
    all.map((q) => {
      if (q.id !== id || q.status !== "pending") return q;
      updated = {
        ...q,
        status: "answered",
        answer: answer.trim().slice(0, 1000),
        answeredAt: new Date().toISOString(),
      };
      return updated;
    })
  );
  if (updated) {
    remember(
      updated.agentId,
      "fact",
      `I asked the owner: "${updated.question}" — owner's answer: "${updated.answer}".`
    );
  }
  return updated;
}

export function dismissQuestion(id: string): boolean {
  let dismissed = false;
  store.update((all) =>
    all.map((q) => {
      if (q.id !== id || q.status !== "pending") return q;
      dismissed = true;
      return { ...q, status: "dismissed" as const };
    })
  );
  return dismissed;
}

export function listQuestions(status?: QuestionStatus): OwnerQuestion[] {
  const all = store.read();
  return status ? all.filter((q) => q.status === status) : all;
}
