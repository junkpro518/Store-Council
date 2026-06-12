import { AsyncLocalStorage } from "node:async_hooks";
import { getPgPool, JsonStore } from "../store/jsonStore.js";
import { currentStoreId } from "../tenancy/context.js";
import { platformConfig } from "../platform/config.js";
import { planOf, Plan } from "./plans.js";

/**
 * Usage metering & plan gates (T020/T021, specs/004-saas-conversion).
 *
 * Ledger model (usage_ledger):
 *  - one row per LLM call with real token counts (kind = work context)
 *  - one zero-token counter row per user message (kind 'chat' | 'mcp') —
 *    that's what the monthly message quota counts, so a multi-tool answer
 *    still costs the merchant exactly one message.
 * Quotas degrade gracefully: callers turn QuotaError into a friendly reply,
 * never a broken UI.
 */

export type UsageKind =
  | "daily_analysis"
  | "impact"
  | "curator"
  | "chat_llm"
  | "mcp_llm"
  | "chat"
  | "mcp"
  | "other";

const kindAls = new AsyncLocalStorage<{ kind: UsageKind }>();

export function runWithUsageKind<T>(kind: UsageKind, fn: () => T): T {
  return kindAls.run({ kind }, fn);
}

export function currentUsageKind(): UsageKind {
  return kindAls.getStore()?.kind ?? "other";
}

export class QuotaError extends Error {
  quota = true as const;
}

interface PoolLike {
  query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

function pool(): PoolLike | null {
  return (getPgPool() as PoolLike) ?? null;
}

const platformKv = new JsonStore<{ plan?: string }>("platform", {});

/** The tenant's effective plan (sync; kv-mirrored by the billing handlers). */
export function currentPlan(): Plan {
  return planOf(platformKv.read().plan);
}

export function metering(): boolean {
  return platformConfig.storage === "postgres";
}

/** Record one LLM call's tokens. Fire-and-forget; never blocks the loop. */
export function recordLlmUsage(model: string, inputTokens: number, outputTokens: number): void {
  const p = pool();
  if (!metering() || !p) return;
  void p
    .query(
      `insert into usage_ledger (store_id, date, kind, model, input_tokens, output_tokens)
       values ($1, current_date, $2, $3, $4, $5)`,
      [currentStoreId(), currentUsageKind(), model, Math.round(inputTokens), Math.round(outputTokens)]
    )
    .catch((err) => console.error("[usage] ledger insert failed:", (err as Error).message));
}

/** Record one user message (the unit the monthly quota counts). */
export async function recordMessage(kind: "chat" | "mcp"): Promise<void> {
  const p = pool();
  if (!metering() || !p) return;
  await p.query(
    `insert into usage_ledger (store_id, date, kind, model, input_tokens, output_tokens)
     values ($1, current_date, $2, '-', 0, 0)`,
    [currentStoreId(), kind]
  );
}

export async function messagesThisMonth(): Promise<number> {
  const p = pool();
  if (!p) return 0;
  const { rows } = await p.query(
    `select count(*)::int as n from usage_ledger
     where store_id = $1 and kind in ('chat','mcp') and date >= date_trunc('month', current_date)`,
    [currentStoreId()]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function tokensToday(): Promise<number> {
  const p = pool();
  if (!p) return 0;
  const { rows } = await p.query(
    `select coalesce(sum(input_tokens + output_tokens), 0)::bigint as n
     from usage_ledger where store_id = $1 and date = current_date`,
    [currentStoreId()]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function onDemandRunsThisMonth(): Promise<number> {
  const p = pool();
  if (!p) return 0;
  const { rows } = await p.query(
    `select count(*)::int as n from jobs
     where store_id = $1 and type = 'daily_analysis' and payload->>'manual' = 'true'
       and run_at >= date_trunc('month', current_date)`,
    [currentStoreId()]
  );
  return Number(rows[0]?.n ?? 0);
}

/** Manager ids usable under the tenant's plan (GM is always allowed). */
export async function planManagerGate(agentId: string): Promise<void> {
  if (!metering() || agentId === "gm") return;
  const plan = currentPlan();
  const { enabledSpecialists } = await import("../agents/definitions.js");
  const allowed = enabledSpecialists().slice(0, plan.maxManagers);
  if (!allowed.some((a) => a.id === agentId)) {
    throw new QuotaError(
      `هذا المدير غير متاح في باقتك الحالية (${plan.maxManagers} مدراء). قم بالترقية لتفعيل المجلس كاملاً. / This manager isn't included in your plan (${plan.maxManagers} managers) — upgrade to unlock the full council.`
    );
  }
}

/** Throw QuotaError when the tenant's message quota is exhausted. */
export async function assertMessageQuota(): Promise<void> {
  if (!metering()) return;
  const plan = currentPlan();
  if ((await messagesThisMonth()) >= plan.chatPerMonth) {
    throw new QuotaError(
      `وصلت إلى حد المحادثات الشهري لباقتك (${plan.chatPerMonth}). قم بالترقية لمتابعة الحوار مع مدرائك. / Monthly chat quota reached (${plan.chatPerMonth}) — upgrade your plan to continue.`
    );
  }
}

/** Throw QuotaError when today's token budget is spent (checked per LLM call). */
export async function assertTokenBudget(): Promise<void> {
  if (!metering()) return;
  const plan = currentPlan();
  if ((await tokensToday()) >= plan.tokensPerDay) {
    throw new QuotaError(
      "تم استهلاك حصة الذكاء الاصطناعي اليومية لباقتك — يتابع مجلسك العمل غداً، أو قم بالترقية. / Today's AI budget for your plan is spent — the council resumes tomorrow, or upgrade."
    );
  }
}
