/**
 * Migration runner (T002, specs/004-saas-conversion).
 *
 *   DATABASE_URL=postgres://... npm run migrate
 *
 * Applies db/migrations/*.sql in filename order, once each, tracked in
 * schema_migrations. Each migration runs in its own transaction (the .sql
 * files contain their own begin/commit; we strip them and wrap ourselves so
 * tracking and DDL commit atomically).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { requireDatabaseUrl } from "../src/platform/config.js";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "db",
  "migrations"
);

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`
    );
    const applied = new Set(
      (await client.query("select name from schema_migrations")).rows.map(
        (r: { name: string }) => r.name
      )
    );
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs
        .readFileSync(path.join(migrationsDir, file), "utf8")
        .replace(/^\s*begin;\s*$/gim, "")
        .replace(/^\s*commit;\s*$/gim, "");
      console.log(`applying ${file}...`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        ran++;
      } catch (err) {
        await client.query("rollback");
        throw new Error(`${file} failed: ${(err as Error).message}`);
      }
    }
    console.log(ran === 0 ? "Nothing to apply — schema is up to date." : `Applied ${ran} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
