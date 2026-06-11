# 06 — Code Migration Plan (File by File)

Principle: **every step leaves the app working** (single-tenant mode keeps functioning until P2 flips identity). Each step compiles, boots, and passes the smoke tests before the next.

## Step 0 — Prep (no behavior change)

- Add `pg` (or `@supabase/supabase-js`) + a tiny migration runner (e.g. `node-pg-migrate`); commit the 03 schema as migration 001.
- Add `src/platform/config.ts`: platform-level config (DB URL, platform AI keys, Salla app credentials, encryption key) read from env/secrets — these *leave* tenant settings later.
- Add `dist/worker.js` entry (`src/worker.ts`) that currently just logs — deploy plumbing first.

## Step 1 — Storage swap behind the same interface

| File | Change |
|---|---|
| `src/store/jsonStore.ts` | Keep for dev/dedicated mode. Add `src/store/tenantStore.ts` implementing `read/write/update(storeId, …)` against Postgres (kv_state first; structured tables per 03 as each module migrates). `update` = transaction with `FOR UPDATE`. |
| All 11 store call sites | Switch to `TenantStore`, passing a constant `DEFAULT_STORE_ID` for now (a seeded `stores` row). App is now DB-backed but still single-tenant. |
| One-time importer | `scripts/import-json-data.ts`: reads a `DATA_DIR` and inserts into the tenant's rows (used again in 08 to migrate existing customers). |

**Checkpoint:** all existing smoke tests pass against Postgres with the default tenant.

## Step 2 — Thread the tenant context

Mechanical signature changes, top-down:

| File | Change |
|---|---|
| `src/server.ts` | `requireAuth` → `requireTenant`: resolves `req.tenant` (P2 will resolve from accounts; for now default tenant). Every handler passes `tenant.storeId` down. |
| `src/agents/runner.ts` | `runAgent(tenant, agentId, question, depth, history)`. Tenant flows into `buildTools`, `systemPrompt`, provider selection (plan→model). |
| `src/agents/tools.ts` | `buildTools(tenant, agent, …)`; `salla_read` uses tenant tokens; `consult_agent` forwards tenant; memory/board/metrics tools call with `storeId`. |
| `src/agents/memory.ts`, `board.ts` | Functions gain `storeId` first parameter (their stores already swapped in Step 1). |
| `src/agents/prompts.ts`, `definitions.ts` | `agentOverride`/`effectiveAgent(storeId, id)`; settings read per tenant. |
| `src/salla/auth.ts`, `client.ts`, `storeInfo.ts` | `getAccessToken(storeId)`, `sallaGet(storeId, …)`; token refresh writes per tenant. App credentials come from platform config. |
| `src/pipeline/daily.ts`, `impact.ts`, `curator.ts`, `metrics.ts` | All entry points take `storeId`; board reset/read scoped. |
| `src/mcp/council.ts` | `buildCouncilMcpServer(tenant)`. |
| `src/llm/client.ts` | Keys from platform config (tenant BYOK override hook); add the usage-metering wrapper writing `usage_ledger`. |

**Checkpoint:** same behavior, every call explicitly tenant-scoped; grep proves no module reads state without a `storeId`.

## Step 3 — Webhook routing & auto-provisioning

| File | Change |
|---|---|
| `src/salla/webhooks.ts` | Verify with platform webhook secret; resolve tenant by `merchant`; `app.store.authorize` for unknown merchant → create `stores` row (status `trial`, `trial_ends_at = now()+7d`), save tokens, enqueue welcome analysis; `app.uninstalled` → status change + retention timestamp. |
| New `src/billing/subscriptions.ts` | `app.subscription.*` handlers per 04, `PLAN_MATRIX`, plan resolution. |

## Step 4 — Jobs & worker

| File | Change |
|---|---|
| New `src/jobs/queue.ts` | enqueue / claim (`SKIP LOCKED`) / complete / retry with backoff (3 attempts). |
| New `src/worker.ts` | minute-tick enqueuer (per-tenant schedule + jitter) + worker pool (start: 4 concurrent jobs) running `daily_analysis` / `impact_measurement` / `curator_run`. |
| `src/pipeline/daily.ts` | Remove the post-run fire-and-forget for impact/curator → enqueue follow-up jobs instead. Remove `node-cron` from `server.ts` (web process no longer schedules). |
| `POST /reports/run` | Becomes "enqueue now + quota check"; `/reports/status` reads the job row. |

## Step 5 — Accounts & billing UI (P2)

| Area | Change |
|---|---|
| `src/auth/owner.ts` → `src/auth/accounts.ts` | accounts/sessions/roles per 05; login-with-Salla flow; keep scrypt utils. |
| `public/app.js` | Login screen gains "Sign in with Salla"; Settings loses AI-key/app-credential fields; gains plan & usage card; locked-state screen with ledger + reactivate. |
| Quota middleware | on `/reports/run`, `/agents/:id/chat`, MCP `ask_manager`. |

## Step 6 — Admin & ops (P3)

- `/admin` module (05), monitoring/metering dashboards (07), retention purge job, reconciliation job (04).

## Testing strategy through migration

- Convert the ad-hoc smoke scripts used during development into a committed `tests/` suite (run against a disposable Postgres via docker-compose): storage contract tests (JsonStore vs TenantStore behave identically), tenant-isolation test (two seeded stores, assert zero cross-reads at the API), webhook routing/idempotency tests, quota-gate tests, job-queue claim/retry tests.
- A **stub LLM provider** (`provider: "stub"` returning canned responses) so the full daily pipeline runs in CI without API costs.

## Effort map

| Step | Size |
|---|---|
| 0–1 Storage swap | ~4–6 days |
| 2 Tenant threading | ~4–5 days (mechanical but wide) |
| 3 Webhooks/provisioning | ~2–3 days |
| 4 Jobs/worker | ~4–5 days |
| 5 Accounts/billing | ~7–10 days (includes Salla plan setup + UI) |
| 6 Admin/ops | ~5 days |
