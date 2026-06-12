/**
 * Job queue & scheduling test (T017 → SC-4, specs/004-saas-conversion).
 * Requires a migrated Postgres:
 *
 *   DATABASE_URL=postgres://... npx tsx tests/job-queue.ts
 *
 * 1. 50 tenants, mixed timezones: each gets exactly one daily job (idempotent
 *    enqueuer; not-yet-due tenants get none).
 * 2. Two concurrent "workers" claim with SKIP LOCKED: no overlap, caps hold.
 * 3. Kill/reclaim: stale running jobs requeue; retries back off; 3rd failure
 *    is terminal.
 * 4. End-to-end: a real worker process executes a daily_analysis job for a
 *    provisioned tenant against a mock LLM, producing a real report.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";

process.env.STORAGE = "postgres";
process.env.DATA_DIR = "/tmp/jobq-empty";

const { initStorage, closeStorage, getPgPool, loadTenant, JsonStore } = await import(
  "../src/store/jsonStore.js"
);
const { runWithTenant } = await import("../src/tenancy/context.js");
const { enqueueDueDailyJobs, jitterMinutes, localClock } = await import(
  "../src/jobs/enqueuer.js"
);
const { claimJobs, failJob, completeJob, reclaimStale } = await import(
  "../src/jobs/queue.js"
);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

await initStorage();
const pool = getPgPool() as {
  query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};
await pool.query("delete from jobs");
await pool.query("delete from kv_state where store_id <> '00000000-0000-0000-0000-000000000001'");
await pool.query("delete from stores where id <> '00000000-0000-0000-0000-000000000001'");

// ---------- 1. 50 tenants, mixed timezones, exactly-once scheduling ----------
const zones = ["Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Africa/Cairo", "Europe/London"];
const dueIds: string[] = [];
for (let i = 0; i < 50; i++) {
  const tz = zones[i % zones.length];
  const { rows } = await pool.query(
    "insert into stores (salla_merchant_id, status) values ($1, 'active') returning id",
    [10_000 + i]
  );
  const id = String(rows[0].id);
  // 45 tenants due now (schedule = current local hour-2, jitter-safe);
  // 5 not due (schedule = 23:59 minus jitter can't fire before ~23:39).
  const due = i < 45;
  const { minutes } = localClock(tz);
  const target = due ? Math.max(0, Math.floor(minutes / 60) - 2) : 23;
  await pool.query(
    `insert into kv_state (store_id, kind, value) values ($1, 'settings', $2::jsonb)`,
    [id, JSON.stringify({ dailyCron: `${due ? 0 : 59} ${target} * * *`, timezone: tz })]
  );
  if (due) dueIds.push(id);
}
// also one disabled tenant — must never be scheduled
const { rows: disRows } = await pool.query(
  "insert into stores (salla_merchant_id, status) values (99999, 'active') returning id"
);
await pool.query(
  `insert into kv_state (store_id, kind, value) values ($1, 'settings', '{"dailyEnabled": false}'::jsonb)`,
  [disRows[0].id]
);

const pass1 = await enqueueDueDailyJobs();
const pass2 = await enqueueDueDailyJobs(); // idempotency
const { rows: jobRows } = await pool.query("select store_id from jobs where state='queued'");
check("45 due tenants → 45 jobs (5 not due, 1 disabled, 0 extra)", jobRows.length === 45, `got ${jobRows.length}`);
check("second pass enqueues nothing (idempotent)", pass2.enqueued === 0, `pass1=${pass1.enqueued}, pass2=${pass2.enqueued}`);
check("every due tenant scheduled exactly once",
  new Set(jobRows.map((r) => String(r.store_id))).size === 45 &&
  dueIds.every((id) => jobRows.some((r) => String(r.store_id) === id)));
check("jitter deterministic and bounded", dueIds.every((id) => {
  const j = jitterMinutes(id);
  return j === jitterMinutes(id) && j >= -20 && j <= 20;
}));

// ---------- 2. Two workers claim concurrently: no overlap, caps hold ----------
const [a, b] = await Promise.all([claimJobs("worker-A", 8), claimJobs("worker-B", 8)]);
const idsA = new Set(a.map((j) => j.id));
check("worker caps respected", a.length === 8 && b.length === 8);
check("no job claimed twice (SKIP LOCKED)", b.every((j) => !idsA.has(j.id)));

// ---------- 3. Crash reclaim + retry/backoff + terminal failure ----------
// Isolate the chain: only a[0] (running) remains; claims now have one candidate.
await pool.query("delete from jobs where id <> $1", [a[0].id]);
await pool.query("update jobs set locked_at = now() - interval '45 minutes' where id = $1", [a[0].id]);
const reclaimed = await reclaimStale(30);
check("stale running job reclaimed", reclaimed === 1);
const [reclaimedJob] = await claimJobs("worker-C", 1);
check("reclaimed job claimable again, attempts incremented", reclaimedJob?.attempts === 2);

await failJob(reclaimedJob.id, reclaimedJob.attempts, "boom-2");
const { rows: afterFail } = await pool.query("select state, run_at > now() as backoff from jobs where id=$1", [reclaimedJob.id]);
check("2nd failure requeued with backoff", afterFail[0].state === "queued" && afterFail[0].backoff === true);
await pool.query("update jobs set run_at = now() where id = $1", [reclaimedJob.id]);
const [third] = await claimJobs("worker-C", 1);
await failJob(third.id, third.attempts, "boom-3");
const { rows: terminal } = await pool.query("select state, payload->>'last_error' as err from jobs where id=$1", [third.id]);
check("3rd failure terminal", terminal[0].state === "failed" && terminal[0].err === "boom-3");

// ---------- 4. End-to-end: real worker executes a job against a mock LLM ----------
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const parsed = body ? JSON.parse(body) : {};
    const isStructured = !parsed.messages?.some((m: { role: string }) => m.role === "system");
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: isStructured
        ? '{"actions":[{"title":"إجراء تجريبي","manager":"pricing","what":"w","why":"y","how":"h","impact":"i","priority":1}]}'
        : "تحليل تجريبي: لا ملاحظات حرجة اليوم." } }],
    }));
  });
});
await new Promise<void>((r) => mock.listen(4998, "127.0.0.1", r));

const e2eStore = dueIds[0];
await loadTenant(e2eStore);
await runWithTenant(e2eStore, () => {
  new JsonStore("settings", {}).write({
    openRouter: { apiKey: "sk-or-mock", model: "mock/model" },
    analysisConcurrency: 8,
    agents: Object.fromEntries(
      // keep the e2e fast: only two specialists enabled
      ["catalog","pricing","marketing","seo","cro","customer-service","retention","orders",
       "shipping","inventory","finance","reviews","payments","geo","growth"]
        .map((id) => [id, { enabled: ["pricing", "seo"].includes(id) }])
    ),
  });
});
await pool.query("select pg_notify('kv_changed', $1)", [
  JSON.stringify({ kind: "settings", storeId: e2eStore, src: "test" }),
]);
// Fresh, isolated job for the e2e tenant.
await pool.query("delete from jobs");
const { enqueueJob } = await import("../src/jobs/queue.js");
await enqueueJob(e2eStore, "daily_analysis", localClock("Asia/Riyadh").date);

const worker = spawn("npx", ["tsx", "src/worker.ts"], {
  env: {
    ...process.env,
    WORKER_TICK_MS: "1000",
    OPENROUTER_BASE_URL: "http://127.0.0.1:4998/api/v1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
worker.stdout.on("data", (d) => process.stdout.write(`  [w] ${d}`));
worker.stderr.on("data", (d) => process.stderr.write(`  [w!] ${d}`));

let jobDone = false;
for (let i = 0; i < 120 && !jobDone; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const { rows } = await pool.query(
    "select state from jobs where store_id = $1 and type = 'daily_analysis'", [e2eStore]);
  jobDone = rows[0]?.state === "done";
}
check("worker executed the daily job to done", jobDone);
const { rows: rep } = await pool.query(
  "select value from kv_state where kind = 'daily-reports' and store_id = $1", [e2eStore]);
const reports = (rep[0]?.value ?? []) as { summary?: string; actions?: unknown[] }[];
check("real report produced for the tenant", reports.length === 1 && Boolean(reports[0].summary));
check("structured actions extracted", (reports[0]?.actions?.length ?? 0) > 0);
const { rows: followups } = await pool.query(
  "select type from jobs where store_id = $1 and type in ('impact_measurement','curator_run')", [e2eStore]);
check("follow-up jobs enqueued by the daily run", followups.length >= 1, followups.map((r) => r.type).join(","));

worker.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 1500));
mock.close();
await closeStorage();
const hash = crypto.createHash("sha1").update("cleanup").digest; void hash;
console.log(failures === 0 ? "\nJob queue & scheduling all green ✅ (SC-4)" : `\n${failures} failed ❌`);
process.exit(failures === 0 ? 0 : 1);
