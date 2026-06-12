/**
 * Worker process (T015/T016, specs/004-saas-conversion).
 *
 *   STORAGE=postgres DATABASE_URL=... npm run worker
 *
 * Owns all long-running work in the SaaS topology. Each tick: reclaim stale
 * locks (crash recovery) → enqueue due daily analyses per tenant (timezone +
 * jitter; idempotent) → claim jobs up to the global concurrency cap and
 * execute them inside their tenant's context. In json (dedicated) mode the
 * web process keeps its internal cron and this process is not needed.
 */
import { platformConfig } from "./platform/config.js";
import { initStorage, flushStorage, loadTenant } from "./store/jsonStore.js";
import { runWithTenant } from "./tenancy/context.js";
import { claimJobs, completeJob, failJob, reclaimStale, Job } from "./jobs/queue.js";
import { enqueueDueDailyJobs } from "./jobs/enqueuer.js";

console.log(
  `[worker] starting — storage=${platformConfig.storage}, concurrency=${platformConfig.worker.globalConcurrency}, tick=${platformConfig.worker.tickMs}ms`
);
if (platformConfig.storage !== "postgres") {
  console.error(
    "[worker] requires STORAGE=postgres (json/dedicated mode schedules inside the web process) — exiting."
  );
  process.exit(1);
}
if (!platformConfig.databaseUrl) {
  console.error("[worker] STORAGE=postgres but DATABASE_URL is not set — exiting.");
  process.exit(1);
}
await initStorage();

const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let inFlight = 0;
let stopping = false;

async function executeJob(job: Job): Promise<void> {
  await loadTenant(job.store_id);
  await runWithTenant(job.store_id, async () => {
    switch (job.type) {
      case "daily_analysis": {
        const { runDailyAnalysis } = await import("./pipeline/daily.js");
        const report = await runDailyAnalysis();
        console.log(`[worker] daily ${report.date} done for store ${job.store_id.slice(0, 8)}`);
        break;
      }
      case "impact_measurement": {
        const { runImpactMeasurements } = await import("./pipeline/impact.js");
        const n = await runImpactMeasurements();
        if (n > 0) console.log(`[worker] measured ${n} action(s) for ${job.store_id.slice(0, 8)}`);
        break;
      }
      case "curator_run": {
        const { runCurator } = await import("./pipeline/curator.js");
        await runCurator();
        break;
      }
    }
  });
}

async function tick(): Promise<void> {
  try {
    const reclaimed = await reclaimStale(30);
    if (reclaimed > 0) console.log(`[worker] reclaimed ${reclaimed} stale job(s)`);

    const { enqueued } = await enqueueDueDailyJobs();
    if (enqueued > 0) console.log(`[worker] enqueued ${enqueued} daily analysis job(s)`);

    const capacity = platformConfig.worker.globalConcurrency - inFlight;
    const jobs = await claimJobs(workerId, capacity);
    for (const job of jobs) {
      inFlight++;
      console.log(`[worker] running job ${job.id} (${job.type}, attempt ${job.attempts})`);
      void executeJob(job)
        .then(() => completeJob(job.id))
        .catch((err) => {
          console.error(`[worker] job ${job.id} failed:`, (err as Error).message);
          return failJob(job.id, job.attempts, (err as Error).message);
        })
        .finally(() => {
          inFlight--;
        });
    }
  } catch (err) {
    console.error("[worker] tick failed:", (err as Error).message);
  }
}

const timer = setInterval(() => {
  if (!stopping) void tick();
}, platformConfig.worker.tickMs);
void tick(); // immediate first pass

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received — draining (${inFlight} in flight)`);
    stopping = true;
    clearInterval(timer);
    const wait = setInterval(() => {
      if (inFlight === 0) {
        clearInterval(wait);
        void flushStorage().finally(() => process.exit(0));
      }
    }, 250);
    setTimeout(() => {
      void flushStorage().finally(() => process.exit(0));
    }, 30_000).unref();
  });
}
