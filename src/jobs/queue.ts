import { getPgPool } from "../store/jsonStore.js";

/**
 * Postgres-backed job queue (T014, specs/004-saas-conversion).
 *
 * Standard SKIP LOCKED pattern: workers claim due jobs atomically, so any
 * number of worker processes can share the queue without double-running.
 * Retries with backoff (3 attempts), crash recovery via stale-lock reclaim,
 * and the partial unique index one_daily_per_store_per_day guarantees at
 * most one scheduled analysis per store per tenant-local day.
 */

export type JobType = "daily_analysis" | "impact_measurement" | "curator_run";

export interface Job {
  id: number;
  store_id: string;
  type: JobType;
  run_at: string;
  run_date: string;
  state: "queued" | "running" | "done" | "failed";
  attempts: number;
  payload: Record<string, unknown>;
}

interface PoolLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

function pool(): PoolLike {
  const p = getPgPool();
  if (!p) throw new Error("Job queue requires STORAGE=postgres.");
  return p as PoolLike;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MINUTES = [1, 5, 15]; // per attempt

/** Enqueue a job. Returns the id, or null when deduplicated (daily unique). */
export async function enqueueJob(
  storeId: string,
  type: JobType,
  runDate: string,
  runAt: Date = new Date(),
  payload: Record<string, unknown> = {}
): Promise<number | null> {
  const { rows } = await pool().query(
    `insert into jobs (store_id, type, run_at, run_date, payload)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (store_id, type, run_date) where type = 'daily_analysis' and state in ('queued','running')
     do nothing
     returning id`,
    [storeId, type, runAt.toISOString(), runDate, JSON.stringify(payload)]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** Atomically claim up to `limit` due jobs for this worker (SKIP LOCKED). */
export async function claimJobs(workerId: string, limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  const { rows } = await pool().query(
    `update jobs set state = 'running', locked_by = $1, locked_at = now(), attempts = attempts + 1
     where id in (
       select id from jobs
       where state = 'queued' and run_at <= now()
       order by run_at
       for update skip locked
       limit $2
     )
     returning id, store_id, type, run_at, run_date, state, attempts, payload`,
    [workerId, limit]
  );
  return rows as unknown as Job[];
}

export async function completeJob(id: number): Promise<void> {
  await pool().query("update jobs set state = 'done', locked_by = null where id = $1", [id]);
}

/** Failure: requeue with backoff while attempts remain, else mark failed. */
export async function failJob(id: number, attempts: number, error: string): Promise<void> {
  if (attempts < MAX_ATTEMPTS) {
    const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
    await pool().query(
      `update jobs set state = 'queued', locked_by = null,
         run_at = now() + ($2 || ' minutes')::interval,
         payload = payload || jsonb_build_object('last_error', $3::text)
       where id = $1`,
      [id, String(backoff), error.slice(0, 500)]
    );
  } else {
    await pool().query(
      `update jobs set state = 'failed', locked_by = null,
         payload = payload || jsonb_build_object('last_error', $2::text)
       where id = $1`,
      [id, error.slice(0, 500)]
    );
  }
}

/** Crash recovery: requeue jobs whose worker stopped heartbeating. */
export async function reclaimStale(olderThanMinutes = 30): Promise<number> {
  const { rows } = await pool().query(
    `update jobs set state = 'queued', locked_by = null
     where state = 'running' and locked_at < now() - ($1 || ' minutes')::interval
     returning id`,
    [String(olderThanMinutes)]
  );
  return rows.length;
}

/** Is a job of this type queued/running for the store right now? */
export async function activeJob(storeId: string, type: JobType): Promise<boolean> {
  const { rows } = await pool().query(
    "select 1 from jobs where store_id = $1 and type = $2 and state in ('queued','running') limit 1",
    [storeId, type]
  );
  return rows.length > 0;
}
