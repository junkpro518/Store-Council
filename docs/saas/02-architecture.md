# 02 — Multi-Tenant Architecture

## Target topology

```
                        ┌──────────────────────────────┐
   Merchants ──HTTPS──▶ │  Web/API process (Express)   │
   (dashboard, MCP)     │  - auth, dashboard, chat,    │
                        │    reports API, MCP, billing │
   Salla ──webhooks──▶  │  - webhook router (merchant→ │
                        │    tenant)                   │
                        └───────┬──────────────────────┘
                                │
                        ┌───────▼──────────────────────┐
                        │  PostgreSQL                  │
                        │  - all tenant state          │
                        │  - job queue table           │
                        └───────┬──────────────────────┘
                                │ polls jobs
                        ┌───────▼──────────────────────┐
                        │  Worker process(es)          │
                        │  - daily analyses            │
                        │  - impact measurements       │
                        │  - curator runs              │
                        │  (N agents in parallel,      │
                        │   global concurrency cap)    │
                        └──────────────────────────────┘
```

Two deployable processes from the same codebase (`node dist/server.js` and `node dist/worker.js`), one database. Chat requests stay in the web process (interactive latency); everything long-running moves to the worker.

## Tenancy model: shared schema, `store_id` everywhere

- One row space per concern, every table carries `store_id` (the Salla merchant id is `salla_merchant_id`; internal `store_id` is our UUID so we can support Zid later without key collisions).
- **Isolation rule:** no query without a `store_id` predicate. Enforced two ways:
  1. The `TenantStore` API takes `storeId` as a required constructor/argument — there is no method to read across tenants outside the explicit admin module.
  2. Optional hardening: Postgres **row-level security** with `SET app.current_store = …` per request/job (belt and suspenders; recommended once on Supabase).
- A **dedicated tier** (enterprise) can still run the classic single-store deployment per customer — the same code with the "default tenant" — which is why P0 keeps single-tenant mode working.

## The tenant context

A single value threaded everywhere a store is implied today:

```ts
export interface Tenant {
  storeId: string;            // internal UUID
  sallaMerchantId: number;
  plan: PlanId;               // see 04
  status: "trial" | "active" | "past_due" | "locked";
}
```

Carriers:
- **HTTP**: resolved from the merchant session (or integration token) by middleware → `req.tenant`. 404/403 on any cross-tenant id in a path.
- **Webhooks**: resolved from payload `merchant` → tenant lookup; unknown merchant + `app.store.authorize` ⇒ **tenant auto-provisioning** (this is how installs create tenants).
- **Jobs**: every queue row carries `store_id`; the worker builds the tenant context before running.
- **Agent layer**: `runAgent(tenant, agentId, …)` — the runner passes tenant into tools (`salla_read` uses the tenant's tokens), memory, board, metrics. Mechanical change; see 06.

## Storage: replacing `JsonStore`

Today: `new JsonStore<T>(name, fallback)` → file. Target: same interface plus tenancy:

```ts
class TenantStore<T> {
  constructor(private kind: string) {}
  read(storeId: string): T;
  write(storeId: string, value: T): void;
  update(storeId: string, fn: (cur: T) => T): T;   // SELECT ... FOR UPDATE
}
```

Two implementation strategies (03 details the schema):
- **Structured tables** for high-value queryable data: reports, actions, memories, metrics, events, jobs, subscriptions.
- **A `kv_state` JSONB table** for low-churn blobs (settings, salla tokens, store-info cache, curator state, council board) — fastest path; promote to real tables later if query needs appear.

`update()` must be transactional (`SELECT … FOR UPDATE` or optimistic version column) — the file version was process-local; SaaS has concurrent web + worker writers.

## Scheduler → job queue

Today: one `node-cron` task fires the single store's analysis. SaaS needs per-tenant schedules without 5,000 cron entries:

- **`jobs` table** (see 03): `(id, store_id, type, run_at, state, attempts, locked_by, locked_at, payload)`.
- A lightweight **enqueuer** runs every minute in the worker: for each active tenant whose local analysis time matches (tenant timezone + preferred hour, default 05:00, **jittered ±20 min** to spread provider load), insert a `daily_analysis` job if none exists for that date.
- **Workers claim jobs** with `UPDATE … SET locked_by … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)` — the standard Postgres queue pattern; no Redis needed.
- Job types: `daily_analysis`, `impact_measurement`, `curator_run`, `event_alert` (future). Impact + curator stop piggybacking on the daily run's process (today's post-run hook) and become enqueued follow-up jobs — more robust to restarts.
- **Concurrency control,** two levels: per-tenant (one running analysis per store — exists today as a flag, becomes a DB constraint) and global (worker pool size caps simultaneous LLM-heavy jobs; provider rate limits are shared now).

## Webhook routing

`POST /webhooks/salla` (one URL for all tenants — Salla sends all events for the app there):
1. Verify HMAC with the **app-level** webhook secret (one secret per Salla app, now platform config, not tenant settings).
2. `merchant` → tenant lookup.
3. `app.store.authorize` for unknown merchant → create tenant (status `trial`), store tokens, schedule welcome analysis.
4. `app.uninstalled` → mark tenant `uninstalled`, revoke tokens, start 90-day data-retention countdown.
5. `app.subscription.*` → billing module (04).
6. Store events → per-tenant event feed (as today).

## AI provider layer

- **Platform-owned keys** in platform config (env/secrets manager — no longer tenant settings). The per-tenant `provider`/`model` choice collapses into **plan-defined model tiers** (e.g. Basic = Sonnet, Pro = Opus) with an internal override field for support.
- **Metering:** wrap both loops' provider calls to record `(store_id, date, input_tokens, output_tokens, model)` into `usage_ledger`. This drives the cost dashboard (07) and plan gates (04).
- **BYO-key** stays as a top-tier option: tenant-supplied key encrypted at rest (see 05), used instead of platform keys, exempt from token gates.

## MCP per tenant

Unchanged protocol; the integration token becomes a per-tenant row (`integration_tokens`), and `POST /mcp` resolves the tenant from the token before building the (already stateless) MCP server with that tenant's context.

## What deliberately does not change

- Express + static SPA (no framework migration).
- Provider-neutral agent loop and tools.
- Read-only Salla client and allowlist.
- The stateless-per-request MCP transport.
