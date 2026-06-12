import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { platformConfig } from "../platform/config.js";

/**
 * The single persistence abstraction (T005/T006, specs/004-saas-conversion).
 *
 * Two backends behind one synchronous interface:
 *  - "json" (default): file per (kind, store) under DATA_DIR — today's
 *    single-store behavior, byte-identical layout for the default tenant.
 *  - "postgres": rows in kv_state with a write-through in-memory cache.
 *    Reads are synchronous from cache (the whole codebase reads inline —
 *    prompts, middleware); writes update the cache synchronously and persist
 *    asynchronously in per-key order; cross-process coherence comes from
 *    Postgres LISTEN/NOTIFY (a peer's write refreshes our cache within ms).
 *
 * Process entries must `await initStorage()` before serving (no-op for json)
 * and `await flushStorage()` on shutdown so queued Postgres writes land.
 *
 * Multi-writer note (documented limitation until P3): update() is atomic
 * within a process; across processes the unit of conflict is the whole value
 * (last write wins), same as today's file semantics. The P3 worker uses the
 * jobs table via direct SQL, not this KV, precisely to avoid relying on
 * cross-process KV transactions.
 */

import { currentStoreId, DEFAULT_STORE_ID } from "../tenancy/context.js";

export { DEFAULT_STORE_ID }; // re-export: scripts/tests import it from here

interface Backend {
  read(kind: string, storeId: string): unknown; // undefined = absent
  write(kind: string, storeId: string, value: unknown): void;
}

// ---------- JSON file backend ----------

class JsonFileBackend implements Backend {
  private file(kind: string, storeId: string): string {
    // Default tenant keeps the legacy layout (data/<kind>.json); other
    // tenants nest under data/tenants/<id>/ — same files, same format.
    return storeId === DEFAULT_STORE_ID
      ? path.join(config.dataDir, `${kind}.json`)
      : path.join(config.dataDir, "tenants", storeId, `${kind}.json`);
  }

  read(kind: string, storeId: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(this.file(kind, storeId), "utf8"));
    } catch {
      return undefined;
    }
  }

  write(kind: string, storeId: string, value: unknown): void {
    const file = this.file(kind, storeId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Atomic write: a crash mid-write must never corrupt existing data.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  }
}

// ---------- Postgres kv_state backend ----------

type PgPoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: { value?: unknown; kind?: string }[] }>;
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<unknown>;
    on: (ev: string, fn: (msg: { payload?: string }) => void) => void;
    release: (destroy?: boolean) => void;
  }>;
  end: () => Promise<void>;
};

class PgKvBackend implements Backend {
  private cache = new Map<string, unknown>(); // `${storeId}/${kind}` -> value
  private chains = new Map<string, Promise<void>>(); // per-key ordered persistence
  private loaded = new Set<string>(); // storeIds with cache preloaded
  private listenClient: Awaited<ReturnType<PgPoolLike["connect"]>> | null = null;
  readonly instanceId = crypto.randomBytes(8).toString("hex");

  constructor(private pool: PgPoolLike) {}

  private key(kind: string, storeId: string): string {
    return `${storeId}/${kind}`;
  }

  isLoaded(storeId: string): boolean {
    return this.loaded.has(storeId);
  }

  async preloadStore(storeId: string): Promise<void> {
    const { rows } = await this.pool.query(
      "select kind, value from kv_state where store_id = $1",
      [storeId]
    );
    for (const row of rows) this.cache.set(this.key(String(row.kind), storeId), row.value);
    this.loaded.add(storeId);
  }

  async listen(): Promise<void> {
    const client = await this.pool.connect();
    this.listenClient = client;
    client.on("notification" as never, (msg: { payload?: string }) => {
      void (async () => {
        try {
          const { kind, storeId, src } = JSON.parse(msg.payload ?? "{}");
          if (src === this.instanceId) return; // our own write; cache is newer
          if (!this.loaded.has(storeId)) return;
          const { rows } = await this.pool.query(
            "select value from kv_state where store_id = $1 and kind = $2",
            [storeId, kind]
          );
          if (rows[0]) this.cache.set(this.key(kind, storeId), rows[0].value);
        } catch (err) {
          console.error("[storage] notification refresh failed:", err);
        }
      })();
    });
    await client.query("listen kv_changed");
  }

  read(kind: string, storeId: string): unknown {
    if (!this.loaded.has(storeId)) {
      throw new Error(
        `Storage not initialized for store ${storeId} — initStorage() must run (and preload the tenant) before reads.`
      );
    }
    return this.cache.get(this.key(kind, storeId));
  }

  write(kind: string, storeId: string, value: unknown): void {
    const key = this.key(kind, storeId);
    this.cache.set(key, value);
    const json = JSON.stringify(value);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      await this.pool.query(
        `insert into kv_state (store_id, kind, value, version) values ($1, $2, $3::jsonb, 1)
         on conflict (store_id, kind) do update set value = excluded.value, version = kv_state.version + 1`,
        [storeId, kind, json]
      );
      await this.pool.query("select pg_notify('kv_changed', $1)", [
        JSON.stringify({ kind, storeId, src: this.instanceId }),
      ]);
    });
    this.chains.set(
      key,
      next.catch((err) => {
        // Keep the chain alive; the cache stays authoritative in-process.
        console.error(`[storage] persist failed for ${key}:`, (err as Error).message);
      })
    );
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }

  async close(): Promise<void> {
    await this.flush();
    // Destroy (not return) the LISTEN client — a pooled client holding a
    // LISTEN subscription would make pool.end() wait forever.
    this.listenClient?.release(true);
    this.listenClient = null;
    await this.pool.end();
  }
}

// ---------- Backend selection & lifecycle ----------

let active: Backend = new JsonFileBackend();
let pgBackend: PgKvBackend | null = null;
let pgPool: unknown = null;

/** Direct pool access for modules that query real tables (registry, P3 jobs). */
export function getPgPool(): unknown {
  return pgPool;
}

/**
 * Preload a tenant's KV into the cache (postgres mode; no-op for json or if
 * already loaded). Boundaries MUST await this before entering runWithTenant
 * for a non-default store.
 */
export async function loadTenant(storeId: string): Promise<void> {
  if (!pgBackend) return;
  if (pgBackend.isLoaded(storeId)) return;
  await pgBackend.preloadStore(storeId);
}

/**
 * Initialize storage. No-op for the json backend; for postgres: connects,
 * verifies the schema is migrated, ensures the default store row, preloads
 * the default tenant's KV into cache, and starts the coherence listener.
 */
export async function initStorage(): Promise<void> {
  if (platformConfig.storage !== "postgres" || pgBackend) return;
  const { default: pg } = await import("pg");
  const { requireDatabaseUrl } = await import("../platform/config.js");
  const pool = new pg.Pool({ connectionString: requireDatabaseUrl(), max: 5 });
  try {
    await pool.query("select 1 from kv_state limit 1");
  } catch {
    await pool.end();
    throw new Error("kv_state table missing — run `npm run migrate` against DATABASE_URL first.");
  }
  await pool.query(
    `insert into stores (id, name) values ($1, 'default') on conflict (id) do nothing`,
    [DEFAULT_STORE_ID]
  );
  const backend = new PgKvBackend(pool as unknown as PgPoolLike);
  await backend.preloadStore(DEFAULT_STORE_ID);
  await backend.listen();
  pgBackend = backend;
  pgPool = pool;
  active = backend;
  console.log("[storage] postgres backend active (kv preloaded, coherence listener on)");
}

/** Await queued Postgres writes (call on shutdown). No-op for json. */
export async function flushStorage(): Promise<void> {
  await pgBackend?.flush();
}

export async function closeStorage(): Promise<void> {
  await pgBackend?.close();
  pgBackend = null;
}

// ---------- The store class every module uses ----------

export class JsonStore<T> {
  constructor(private kind: string, private fallback: T) {}

  /** Defaults to the ambient tenant (runWithTenant), else the default store. */
  read(storeId: string = currentStoreId()): T {
    const value = active.read(this.kind, storeId);
    return value === undefined ? structuredClone(this.fallback) : (value as T);
  }

  write(value: T, storeId: string = currentStoreId()): void {
    active.write(this.kind, storeId, value);
  }

  update(fn: (current: T) => T, storeId: string = currentStoreId()): T {
    const next = fn(this.read(storeId));
    this.write(next, storeId);
    return next;
  }
}
