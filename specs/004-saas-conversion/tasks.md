# Tasks: 004 — SaaS Conversion (dependency-ordered)

Status legend: [x] done · [ ] pending. Each task ends with the static gates green (typecheck + suite).

## P0 — Foundations
- [x] T001 Author migration `db/migrations/001_initial.sql` — full schema per docs/saas/03 (tenancy, settings, agent state, reports/actions, metrics, events, billing, usage, jobs, kv)
- [x] T002 Add `pg` + minimal migration runner (`scripts/migrate.ts`); `docker-compose.yml` with dev Postgres
- [x] T003 `src/platform/config.ts`: DB URL, platform OpenRouter key, Salla app credentials, encryption key — from env/secrets (leaves tenant settings in P4)
- [x] T004 `src/worker.ts` entry (logs + heartbeat only) wired into build/start scripts

## P1 — Storage swap (app keeps working single-tenant)
- [x] T005 Postgres backend behind the existing store interface (`STORAGE=json|postgres`): write-through cache (sync reads), per-key ordered async persistence, cross-process coherence via LISTEN/NOTIFY, flush-on-shutdown. *Amendment:* implemented inside `jsonStore.ts` with `storeId` params (default tenant) instead of a separate class — zero call-site churn; cross-process transactional `update` deferred to P3 where a second writer (the worker) first exists (documented in the module header)
- [x] T006 All store call sites run on the selected backend via `DEFAULT_STORE_ID` defaults (seeded `stores` row); per-tenant `storeId` parameter ready for P2 threading
- [~] T007 *Re-scoped:* structured-table promotion moves into the phase that first queries each table server-side (jobs→P3 T014, usage_ledger/subscriptions→P4, reports/memories→P5 fleet queries). P1 keeps full-fidelity JSONB kv parity — promoting now would be speculative mapping code with no consumer
- [x] T008 `scripts/import-json-data.ts` + round-trip parity test (`tests/pg-parity.ts`) → **SC-5** ✅
- [x] T009 Suites green on Postgres: storage parity (incl. 50-write ordering + LISTEN/NOTIFY coherence), agent E2E identical on both backends, real-server restart persistence with zero JSON files → **SC-2** ✅

## P2 — Tenant threading
- [x] T010 Tenant context via AsyncLocalStorage (`runWithTenant`/`currentStoreId`): boundaries are explicit, propagation through agent loops/tools/pipeline/salla client is automatic. *Amendment:* ALS instead of the docs/saas/06 signature-threading — zero churn across ~60 call sites, same guarantee (every store access carries a tenant; default = legacy store)
- [x] T011 Webhook router: merchant → tenant lookup with first-merchant-binds-default upgrade path; authorize auto-provisions 7-day trials (+reinstall restore); uninstall sets retention countdown + revokes tokens; unknown-merchant events ignored loudly; platform-level webhook secret (SALLA_WEBHOOK_SECRET) with default-tenant fallback
- [x] T012 Per-tenant integration tokens in the `integration_tokens` table, sha256-hashed at rest, resolved on /mcp, revoked on uninstall. *Amendment:* embed keys stay deployment-level until P4 — owner sessions are deployment-level until accounts exist, so a per-tenant embed key minting a global session would itself be a cross-tenant hole
- [x] T013 `tests/tenant-isolation.ts`: 15 live checks against the production server — routing/provisioning, per-tenant Salla tokens, event feeds, reports+memory via dashboard and MCP, token-scope boundaries, uninstall isolation → **SC-1** ✅ (jobs surface joins the test in P3)

## P3 — Jobs & worker
- [ ] T014 Queue module (enqueue/claim SKIP LOCKED/complete/retry-backoff) + unique daily-job constraint
- [ ] T015 Enqueuer (per-tenant tz + preferred hour + ±20min jitter); worker pool with global cap; remove node-cron from web process
- [ ] T016 Impact measurement + curator as queued follow-up jobs; `/reports/run` → enqueue + quota check stub
- [ ] T017 50-tenant scheduling simulation + kill/reclaim test → **SC-4**

## P4 — Accounts & billing
- [ ] T018 Accounts/sessions/roles (owner|staff) + login-with-Salla; migrate single-owner auth
- [ ] T019 Verify current Salla subscription event names; implement `app.subscription.*` handlers + `subscriptions` table + reconciliation job
- [ ] T020 PLAN_MATRIX + gating middleware (managers count, model tier, analyses/chat quotas, MCP/impact flags) with graceful degradation
- [ ] T021 Usage-metering wrapper on both LLM paths → usage_ledger → **SC-6**
- [ ] T022 UI: login-with-Salla, plan & usage card, locked/win-back screen; remove tenant AI-key fields (platform-owned now)
- [ ] T023 Lifecycle walk test (install→trial→subscribe→past_due→locked→reactivate→uninstall→reinstall) → **SC-3**

## P5 — Fleet admin & ops
- [ ] T024 Central panel fleet view (tenant table: plan/status/usage/cost) + per-tenant drill-down (today's view)
- [ ] T025 Impersonate-for-support with audit_log + visible banner
- [ ] T026 Retention purge job (90d) + owner-initiated immediate deletion endpoint
- [ ] T027 Monitoring counters (queue depth/age, failure rate, spend vs budget) surfaced in fleet view
- [ ] T028 Run docs/saas/08 launch checklist; append results to docs/VERIFICATION.md
