/**
 * Worker process entry (T004, specs/004-saas-conversion).
 *
 *   npm run worker   (or: node dist/worker.js)
 *
 * In the SaaS topology this process owns all long-running work: the per-
 * tenant daily-analysis enqueuer and the job pool (Phase P3 fills these in —
 * see specs/004-saas-conversion/tasks.md T014–T016). For now it establishes
 * the deployable process: config validation, heartbeat, graceful shutdown.
 */
import { platformConfig } from "./platform/config.js";

console.log(
  `[worker] starting — storage=${platformConfig.storage}, concurrency=${platformConfig.worker.globalConcurrency}, tick=${platformConfig.worker.tickMs}ms`
);
if (platformConfig.storage === "postgres" && !platformConfig.databaseUrl) {
  console.error("[worker] STORAGE=postgres but DATABASE_URL is not set — exiting.");
  process.exit(1);
}

const tick = setInterval(() => {
  // P3: enqueue due daily_analysis jobs per tenant, then claim & run jobs.
  console.log(`[worker] heartbeat ${new Date().toISOString()} (queue not yet wired — P3)`);
}, platformConfig.worker.tickMs);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received — shutting down`);
    clearInterval(tick);
    process.exit(0);
  });
}
