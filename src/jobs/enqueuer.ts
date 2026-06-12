import { getPgPool } from "../store/jsonStore.js";
import { enqueueJob } from "./queue.js";

/**
 * Daily-analysis enqueuer (T015, specs/004-saas-conversion).
 *
 * Each minute tick: for every active tenant, compute "now" in the tenant's
 * timezone; once the tenant's preferred time (+ a deterministic per-store
 * jitter of ±20 minutes, spreading provider load) has passed for the local
 * day, enqueue that day's analysis. The partial unique index dedups across
 * ticks, so this is idempotent and crash-safe.
 */

interface PoolLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Deterministic jitter in [-20, +20] minutes from the store id. */
export function jitterMinutes(storeId: string): number {
  let h = 0;
  for (const c of storeId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 41) - 20;
}

/** "HH:MM" from a cron expression's minute/hour fields (fallback 05:00). */
export function scheduleFromCron(cron: string | undefined): { hour: number; minute: number } {
  const parts = (cron ?? "").trim().split(/\s+/);
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 5,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

/** Local date (YYYY-MM-DD) and minutes-since-midnight in a timezone. */
export function localClock(tz: string, at: Date = new Date()): { date: string; minutes: number } {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    zone = "Asia/Riyadh";
  }
  const date = at.toLocaleDateString("en-CA", { timeZone: zone });
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { date, minutes: hour * 60 + minute };
}

export interface EnqueueResult {
  considered: number;
  enqueued: number;
}

/** One enqueuer pass over all active tenants. Idempotent. */
export async function enqueueDueDailyJobs(at: Date = new Date()): Promise<EnqueueResult> {
  const pool = getPgPool() as PoolLike;
  const { rows: stores } = await pool.query(
    "select id from stores where status in ('trial', 'active')"
  );
  if (stores.length === 0) return { considered: 0, enqueued: 0 };

  const { rows: settingsRows } = await pool.query(
    "select store_id, value from kv_state where kind = 'settings' and store_id = any($1)",
    [stores.map((s) => s.id)]
  );
  const settingsByStore = new Map(settingsRows.map((r) => [String(r.store_id), r.value as Record<string, unknown>]));

  let enqueued = 0;
  for (const store of stores) {
    const storeId = String(store.id);
    const s = settingsByStore.get(storeId) ?? {};
    if (s.dailyEnabled === false) continue;
    const tz = typeof s.timezone === "string" && s.timezone ? s.timezone : "Asia/Riyadh";
    const { hour, minute } = scheduleFromCron(s.dailyCron as string | undefined);
    const target = Math.min(Math.max(hour * 60 + minute + jitterMinutes(storeId), 0), 1439);
    const { date, minutes } = localClock(tz, at);
    if (minutes >= target) {
      const id = await enqueueJob(storeId, "daily_analysis", date, at);
      if (id !== null) enqueued++;
    }
  }
  return { considered: stores.length, enqueued };
}
