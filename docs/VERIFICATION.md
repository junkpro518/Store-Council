# Verification & Experimentation Record — سجل التحقق والتجربة

How every layer of Store Council was tested, what each test proved, how to re-run it, and exactly what remains for the real world. This is the audit trail behind the claim "ready for release."

## Methodology

Every feature followed the same loop (per the Karpathy guidelines in CLAUDE.md and the Spec Kit specs in `specs/`):

1. **Spec first** — user stories + measurable success criteria (`specs/NNN-*/spec.md`).
2. **Static gates on every change** — `npm run typecheck` (tsc strict, must be clean) and `node --check` on all three SPAs (`app.js`, `admin.js`).
3. **Unit passes** — pure-logic checks run with tsx against a throwaway `DATA_DIR`, deleted afterwards.
4. **Live HTTP passes** — boot the real server, exercise endpoints with curl, assert real status codes and side effects (never just 200s).
5. **Production-build boot** — `npm run build && node dist/server.js` smoke test from a factory-clean state, including graceful SIGTERM.
6. **Adversarial review** — three specialized sub-agents (security, logic/code integrity, structure/completeness) audited the whole codebase before release; all confirmed findings were fixed and re-verified (`specs/003-release-hardening/`). Two reviewer claims were rejected as false positives after checking against authoritative references — review findings were verified, not blindly applied.

## What was tested, layer by layer

### Authentication & panels
- Merchant first-run setup, login, logout, password change revoking all sessions; 5-failure/10-minute IP lockout (observed the 6th attempt blocked).
- Central panel: independent admin credentials; **token non-interchangeability proven both directions** (merchant token → 401 on `/admin/*`, admin token → 401 on merchant routes); tenant lock → all merchant APIs return 402 while login/status stay reachable → unlock restores.
- Embed auto-login: invalid key 401; valid key mints a working session; rotation invalidates the old link (all live).

### Salla integration (protocol side)
- Webhooks: HMAC-SHA256 over the raw body with computed real signatures — unsigned and tampered deliveries rejected; valid accepted; replay of an identical delivery ignored; `app.store.authorize` connects the store (Easy Mode, merchant binding enforced — a different merchant's authorize is refused); `app.uninstalled` disconnects only the bound merchant.
- Read-only enforcement: GET-only allowlist refuses off-list endpoints; write allowlist refuses DELETE and off-list writes (unit + tool-level tests).
- 429 backoff bounded; pagination bounded.

### Agent system
- Roster (16 agents incl. GEO), prompt assembly (critical rules, memory, knowledge index, playbook index, discussion section, write-mode contract — each asserted present), playbook loading/scoping, knowledge base own/shared visibility and cross-agent denial, memory save/inject/forget/cap, owner-questions ask→answer→memory loop with pending cap, council board self-exclusion, feedback hooks (action dismissed/done → manager memory; change approved/rejected → manager memory), impact-loop scheduling (only ≥14-day done actions due; measuring completes them; ledger excludes dismissed).
- Write modes: tool absent in read-only; GM forced read-only; confirm queues with owner approve/reject; auto executes; per-agent override beats global; `forceReadOnly` strips writes for MCP callers.

### LLM layer (OpenRouter)
- **Full-stack E2E against a faithful local mock of the OpenRouter API** (`tests/e2e-mock-openrouter.ts`, committed): key-validation path, structured-JSON extraction path, and a complete agent loop over real HTTP in which the model requests the `calculate` tool, **our tool genuinely executes**, and the result round-trips into the final reply. This proves every line of our integration; only OpenRouter's side of the wire is mocked.
- **Live check** (`npm run verify:openrouter`): 3 real-API checks (key, structured output, agent loop), <$0.05. *Not runnable from the development sandbox (egress blocked) — run once from any normal machine.*

### MCP
- Real JSON-RPC handshake over HTTP: initialize, tools/list (7 tools), tool calls (roster returned with Arabic names), auth rejection, integration-token rotation severing old clients. Agents invoked via MCP verified read-only-forced.

### UI completeness
- The structure review cross-checked every `fetch()` in both SPAs against routes in `src/server.ts` — no dead controls, no orphan endpoints. Docs (`docs/API.md`) reconciled against the real route table.

## How to re-run everything

```bash
npm ci
npm run typecheck && node --check public/app.js && node --check public/admin.js
npx tsx tests/e2e-mock-openrouter.ts          # offline full-stack E2E
OPENROUTER_API_KEY=sk-or-... npm run verify:openrouter   # live (any machine with egress)
npm run build && node dist/server.js           # prod boot; Ctrl+C tests graceful shutdown
```

## Known limits of this verification — حدود التحقق

Honest list of what no sandbox can prove, and where it gets proven:

| Untested here | Why | Where it gets verified |
|---|---|---|
| OpenRouter live wire | Sandbox egress blocked | `npm run verify:openrouter` on your machine (30s) |
| Salla's real OAuth/webhook deliveries & iframe rendering | Needs a real Partners app + demo store | The pre-listing dress rehearsal (docs/DEPLOYMENT.md) |
| **Quality** of agent analyses on real catalogs | Subjective; needs real data + human judgment | Pilot stores (docs/saas/08-rollout.md exit criteria) |
| Long-horizon behaviors (curator after 7 days, impact after 14 days) | Time-based; logic unit-tested, wall-clock untested | First two weeks of pilot operation |

## SaaS conversion — Phase P0 (2026-06-11)

T001–T004 complete. Migration `db/migrations/001_initial.sql` was applied to a **real Postgres 16 cluster** (initdb'd for the test): clean apply (18 tables + schema_migrations), idempotent re-run, FK chain insert with Arabic content round-trip, and the `one_daily_per_store_per_day` partial unique index actively rejecting a duplicate daily job. Generating the migration from docs/saas/03 caught and fixed a design bug (non-IMMUTABLE `run_at::date` index expression → explicit `run_date` column). Worker entry verified in both modes: json heartbeat + graceful SIGTERM; `STORAGE=postgres` without `DATABASE_URL` refuses to start (exit 1). Runner: `npm run migrate`; dev DB: `docker compose up -d postgres`.

## SaaS conversion — Phase P1 (2026-06-11)

T005–T009 complete (T007 re-scoped into consuming phases; see tasks.md). The storage layer now runs on either backend via `STORAGE=json|postgres`: Postgres mode is a write-through cache (synchronous reads for the inline-reading codebase), per-key ordered async persistence, LISTEN/NOTIFY cross-process coherence, and flush-on-shutdown. Verified against a real Postgres 16: **round-trip parity** for seeded settings/memory/reports incl. Arabic (deep-equality — jsonb canonicalizes key order); **50 rapid updates** all persisted in order; **peer-write coherence** visible in <2s via NOTIFY; the **agent E2E suite passing identically on both backends**; and the **production server surviving a restart with zero JSON files** — owner account, store connection, and settings restored purely from Postgres (first process verifiably dead and port freed before the second served). Two real bugs found and fixed by these tests: a hang in `closeStorage()` (pooled LISTEN client blocking `pool.end()`) and an invalid persistence proof caused by the tsx wrapper swallowing SIGTERM in the test harness (re-proven against `node dist`).

## SaaS conversion — Phase P2 (2026-06-12)

T010–T013 complete. Tenancy is threaded via AsyncLocalStorage (`runWithTenant` at the boundaries — webhook router, MCP auth; automatic propagation inside agent loops and every store access; default = legacy store). Webhooks route by merchant with auto-provisioning (first merchant binds the default store as the upgrade path; later merchants get 7-day trial tenants); per-tenant MCP integration tokens are sha256-hashed at rest and revoked on uninstall. **SC-1 proven** by `tests/tenant-isolation.ts` against the production server on a real Postgres: 15/15 checks — two merchants' Salla tokens, event feeds, reports, and memories never cross any surface (dashboard, MCP, webhooks); an integration token cannot open the dashboard; uninstalling tenant B revokes B's access and leaves A untouched. The test also enforced the coherence contract on external writers, catching a real gap: the importer now `pg_notify`s so live servers see imported data without restart. Regression: agent E2E (json), parity (postgres), and production boot all green after the change.

## SaaS conversion — Phase P3 (2026-06-12)

T014–T017 complete. Postgres-backed job queue (SKIP LOCKED claims, 1/5/15-min backoff, 3-attempt terminal failure, 30-min stale-lock reclaim) + per-tenant enqueuer (timezone-aware, cron-derived hour, deterministic ±20-min jitter, idempotent via the partial unique index) + a real worker loop (reclaim → enqueue → claim → execute inside the tenant context, global concurrency cap, drain-on-SIGTERM). Daily runs enqueue their impact/curator follow-ups in postgres mode; `/reports/run`/`/reports/status` ride the queue; the web cron remains only for json/dedicated mode. **SC-4 proven** by `tests/job-queue.ts` (14/14): 51 tenants across 5 timezones scheduled exactly-once (45 due, 5 not due, 1 disabled; second pass enqueues zero), two concurrent workers never claim the same job, crash reclaim/backoff/terminal paths exact — and a real spawned worker executed a queued daily analysis for a provisioned tenant against the LLM mock, producing a real report with extracted actions and its own follow-up jobs. Regression after the change: tenant isolation 15/15, json agent E2E, json production boot — all green. Also added `docs/OPERATOR-CHECKLIST.md` (living operator procedures) and made maintaining it part of the CLAUDE.md definition of done.

## SaaS conversion — Phase P4 core (2026-06-12)

T019/T020/T021/T023-core complete (T018 accounts + T022 UI are next — they're the only P4 pieces requiring live Salla OAuth). Billing: tolerant `app.subscription.*` handlers → subscriptions table + stores.status + per-tenant kv mirror (so synchronous request-path gates need no DB round-trip); expiry opens a 7-day grace (reports continue), a worker pass locks tenants past grace. Plans: PLAN_MATRIX consumed by gates at every surface — manager count, forced model tier, monthly message quota (a multi-tool answer costs exactly one message), on-demand cap, daily token budget, MCP/impact flags — all degrading to friendly bilingual text (QuotaError), never broken UI. Metering: every LLM call writes real token counts to usage_ledger tagged with its work context. **Proven** by `tests/billing-lifecycle.ts` (17/17) against the production server with signed webhooks and a model-capturing LLM mock: trial→basic (MCP 403, forced tier)→growth (restored, tenant's model used)→expired→locked (402, unscheduled)→reactivated; ledger carries both counter and token rows (SC-6); quota exhaustion returns graceful Arabic text. Full regression green: isolation 15/15, job queue 14/14, parity, json E2E, json boot.
