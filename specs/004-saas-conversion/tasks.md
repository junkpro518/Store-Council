# Tasks: 004 — SaaS Conversion (dependency-ordered)

Status legend: [x] done · [ ] pending. Each task ends with the static gates green (typecheck + suite).

## P0 — Foundations
- [x] T001 Author migration `db/migrations/001_initial.sql` — full schema per docs/saas/03 (tenancy, settings, agent state, reports/actions, metrics, events, billing, usage, jobs, kv)
- [ ] T002 Add `pg` + minimal migration runner (`scripts/migrate.ts`); `docker-compose.yml` with dev Postgres
- [ ] T003 `src/platform/config.ts`: DB URL, platform OpenRouter key, Salla app credentials, encryption key — from env/secrets (leaves tenant settings in P4)
- [ ] T004 `src/worker.ts` entry (logs + heartbeat only) wired into build/start scripts

## P1 — Storage swap (app keeps working single-tenant)
- [ ] T005 `src/store/tenantStore.ts` implementing read/write/update(storeId) against Postgres (kv_state first), transactional `update` (SELECT … FOR UPDATE); `STORAGE=json|postgres` switch
- [ ] T006 Switch all 14 JsonStore call sites to TenantStore with `DEFAULT_STORE_ID` (seeded `stores` row)
- [ ] T007 Promote reports/actions, agent_memories, chat_messages, metrics, webhook_events, jobs to structured tables per the mapping in docs/saas/03
- [ ] T008 `scripts/import-json-data.ts` (DATA_DIR → tenant rows) + round-trip test → **SC-5**
- [ ] T009 Run the full existing verification suite against Postgres → **SC-2**

## P2 — Tenant threading
- [ ] T010 Tenant context type + resolution middleware (`req.tenant`); thread `storeId` through runner/tools/prompts/pipeline/MCP/salla client (signature changes per docs/saas/06 step 2)
- [ ] T011 Webhook router: merchant → tenant lookup; `app.store.authorize` auto-provisions trial tenants; `app.uninstalled` sets retention countdown
- [ ] T012 Per-tenant integration + embed tokens (hashed at rest)
- [ ] T013 Two-tenant isolation test across dashboard/MCP/webhooks/jobs → **SC-1**

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
