/**
 * Postgres storage parity test (T008/T009 → SC-5, SC-2 storage level).
 * Requires a migrated database:
 *
 *   DATABASE_URL=postgres://... npx tsx tests/pg-parity.ts
 *
 * 1. Seeds realistic data through the real JSON backend (child process).
 * 2. Imports it with scripts/import-json-data.ts.
 * 3. Reads it back through the Postgres backend and deep-compares (SC-5).
 * 4. 50 rapid update() calls → flush → row in Postgres shows all 50 (ordering).
 * 5. A second client updates a row + NOTIFY → our cache reflects it (coherence).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

process.env.STORAGE = "postgres";
process.env.DATA_DIR = "/tmp/pgparity-empty"; // must stay unused in pg mode

const seedDir = "/tmp/pgparity-json";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---- 1. Seed via the real JSON backend in a child process ----
fs.rmSync(seedDir, { recursive: true, force: true });
const seedScript = `
import { JsonStore } from "../src/store/jsonStore.js";
new JsonStore("settings", {}).write({ language: "ar", storeContext: "متجر عطور", topActionsCount: 7 });
new JsonStore("agent-memory", {}).write({ pricing: [{ id: "m1", type: "lesson", content: "هامش العطور 60%", createdAt: "2026-06-01T00:00:00Z" }] });
new JsonStore("daily-reports", []).write([{ date: "2026-06-10", startedAt: "", finishedAt: "", summary: "ملخص", departments: {}, actions: [{ title: "خفض الشحن", manager: "shipping", what: "w", why: "y", how: "h", impact: "i", priority: 1, status: "done", statusChangedAt: "2026-06-10T08:00:00Z" }] }]);
new JsonStore("counter", 0).write(0);
`;
const seedFile = "tests/.pgparity-seed.tmp.ts";
fs.writeFileSync(seedFile, seedScript);
execFileSync("npx", ["tsx", seedFile], {
  env: { ...process.env, STORAGE: "json", DATA_DIR: seedDir },
  stdio: "inherit",
});
check("json seed produced files", fs.readdirSync(seedDir).length === 4);

// ---- 2. Import into Postgres ----
execFileSync("npx", ["tsx", "scripts/import-json-data.ts", "--data", seedDir], {
  env: { ...process.env, STORAGE: "json" },
  stdio: "inherit",
});

// ---- 3. Read back through the Postgres backend (SC-5) ----
const { initStorage, flushStorage, closeStorage, JsonStore } = await import(
  "../src/store/jsonStore.js"
);
await initStorage();

for (const kind of ["settings", "agent-memory", "daily-reports"]) {
  const fromJson = JSON.parse(fs.readFileSync(`${seedDir}/${kind}.json`, "utf8"));
  const fromPg = new JsonStore<unknown>(kind, null).read();
  // Deep equality, not string comparison: Postgres jsonb canonicalizes
  // object key order, which is semantically irrelevant.
  check(`round-trip parity: ${kind}`, isDeepStrictEqual(fromPg, fromJson));
}
check(
  "arabic content intact",
  JSON.stringify(new JsonStore<unknown>("agent-memory", null).read()).includes("هامش العطور")
);

// ---- 4. Ordered writes under rapid update() (50 increments) ----
const counter = new JsonStore<number>("counter", 0);
for (let i = 0; i < 50; i++) counter.update((n) => n + 1);
check("sync read after 50 updates", counter.read() === 50);
await flushStorage();
const { default: pg } = await import("pg");
const probe = new pg.Client({ connectionString: process.env.DATABASE_URL });
await probe.connect();
const persisted = await probe.query(
  "select value from kv_state where kind = 'counter' and store_id = '00000000-0000-0000-0000-000000000001'"
);
check("all 50 updates persisted in order", persisted.rows[0]?.value === 50, `db=${persisted.rows[0]?.value}`);

// ---- 5. Cross-process coherence (peer write + NOTIFY → our cache updates) ----
await probe.query(
  `update kv_state set value = '99'::jsonb where kind = 'counter' and store_id = '00000000-0000-0000-0000-000000000001'`
);
await probe.query("select pg_notify('kv_changed', $1)", [
  JSON.stringify({ kind: "counter", storeId: "00000000-0000-0000-0000-000000000001", src: "peer-process" }),
]);
let coherent = false;
for (let i = 0; i < 40 && !coherent; i++) {
  await new Promise((r) => setTimeout(r, 50));
  coherent = counter.read() === 99;
}
check("peer write visible via LISTEN/NOTIFY (≤2s)", coherent);

await probe.end();
await closeStorage();
fs.rmSync(seedDir, { recursive: true, force: true });
fs.rmSync(seedFile, { force: true });
fs.rmSync("/tmp/pgparity-empty", { recursive: true, force: true });

console.log(failures === 0 ? "\nPostgres parity all green ✅" : `\n${failures} failed ❌`);
process.exit(failures === 0 ? 0 : 1);
