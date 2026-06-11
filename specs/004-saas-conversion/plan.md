# Implementation Plan: 004 — SaaS Conversion

**Spec**: [spec.md](spec.md) · **Design docs**: `docs/saas/01-08` (architecture, schema, billing, auth, migration, ops, rollout)

## Technical context

The full design was authored in `docs/saas/` and is not repeated here. This plan sequences it into phases that each leave the app working (the migration's prime directive), and pins what each phase must prove before the next starts. New runtime dependency: `pg` (added in P0, used from P0-3). Development/CI Postgres via docker-compose; the JSON backend remains for the dedicated single-store tier.

## Phases → success criteria

| Phase | Delivers | Proves | Spec SC |
|---|---|---|---|
| **P0 Foundations** | Migration 001 SQL (full schema from docs/saas/03); `src/platform/config.ts` (platform-level env config); `pg` + migration runner; docker-compose for dev DB; worker entry stub | Schema applies cleanly to a fresh Postgres; app still boots unchanged | — |
| **P1 Storage swap** | `TenantStore` (same contract as JsonStore + `storeId`, transactional `update`); all 14 store call sites switched, passing `DEFAULT_STORE_ID`; `scripts/import-json-data.ts` | Existing verification suite green on Postgres; importer round-trips a real DATA_DIR | SC-2, SC-5 |
| **P2 Tenant threading** | Tenant context through server → runner → tools → pipeline → MCP; webhook routing by merchant + auto-provisioning; per-tenant embed/MCP tokens | Two-tenant isolation test green | SC-1 |
| **P3 Jobs & worker** | `jobs` table + SKIP-LOCKED queue; minute-tick enqueuer (tz + jitter); worker pool; impact/curator as queued jobs; `/reports/run` becomes enqueue | 50-tenant scheduling simulation green; kill-and-reclaim test green | SC-4 |
| **P4 Accounts & billing** | Login-with-Salla + roles; `subscriptions` + `app.subscription.*` handlers; PLAN_MATRIX gating middleware; usage metering wrapper; plan/usage UI; locked/win-back screen | Lifecycle walk green against simulated webhooks; metering ledger populated by the mock-LLM e2e | SC-3, SC-6 |
| **P5 Fleet admin & ops** | Central panel fleet view; impersonation (audited); retention purge job; reconciliation job; monitoring counters | Operator can run the docs/saas/08 launch checklist end-to-end | — |

## Verification strategy

- Convert `tests/` into a parameterized suite run against docker-compose Postgres in CI; keep the mock-OpenRouter server as the LLM stub for the full-pipeline tests.
- Each phase ends with: typecheck, suite green, prod boot, and an entry appended to docs/VERIFICATION.md.
- Spec Kit flow per phase: this plan stands; each phase gets its tasks checked off in tasks.md; `/speckit-analyze` before starting P2 and P4 (the two riskiest phases).

## Risks pinned

Postgres-unavailable dev environments (keep JSON backend selectable via `STORAGE=json`); provider rate limits at fleet scale (global cap in P3, raise-limit request before beta); webhook event-name drift (verify `app.subscription.*` names against current Salla docs at P4 start — flagged in docs/saas/04).
