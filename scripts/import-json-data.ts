/**
 * Import a single-store DATA_DIR into Postgres (T008, specs/004-saas-conversion).
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/import-json-data.ts [--data ./data] [--store <uuid>]
 *
 * Every <kind>.json file becomes the tenant's kv_state row — the council's
 * full history (settings, reports, memory, ledger, chats) moves intact.
 * Also used at customer-migration time (docs/saas/08). Idempotent: re-running
 * overwrites with the file contents.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { requireDatabaseUrl } from "../src/platform/config.js";
import { DEFAULT_STORE_ID } from "../src/store/jsonStore.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataDir = arg("--data", "./data");
const storeId = arg("--store", DEFAULT_STORE_ID);

async function main(): Promise<void> {
  if (!fs.existsSync(dataDir)) throw new Error(`Data directory not found: ${dataDir}`);
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error(`No .json files in ${dataDir}`);

  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      "insert into stores (id, name) values ($1, 'imported') on conflict (id) do nothing",
      [storeId]
    );
    let imported = 0;
    for (const file of files) {
      const kind = path.basename(file, ".json");
      const raw = fs.readFileSync(path.join(dataDir, file), "utf8");
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        console.warn(`skipping ${file}: not valid JSON`);
        continue;
      }
      await client.query(
        `insert into kv_state (store_id, kind, value, version) values ($1, $2, $3::jsonb, 1)
         on conflict (store_id, kind) do update set value = excluded.value, version = kv_state.version + 1`,
        [storeId, kind, JSON.stringify(value)]
      );
      console.log(`imported ${kind} (${raw.length} bytes)`);
      imported++;
    }
    console.log(`Done: ${imported} kind(s) → store ${storeId}.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
