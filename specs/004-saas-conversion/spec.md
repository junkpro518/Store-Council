# Feature Specification: SaaS Conversion — Multi-Tenant Subscription Platform

**Branch**: `claude/sweet-clarke-w79ood` · **Created**: 2026-06-11 · **Status**: In progress (Phase P0)
**Design source**: `docs/saas/` (01–08) — authored and decision-locked prior to this spec; treated as the clarification record.

## Primary user stories

### US1 — Merchant self-serve lifecycle (P1)
A merchant installs the app from the Salla App Store → a tenant is auto-provisioned (trial) → first report runs free → they subscribe to a plan through Salla billing → service follows subscription state (active / past-due grace / locked with win-back screen) → uninstall revokes tokens and starts the 90-day retention countdown; reinstall within 90 days restores the council's full memory.

### US2 — Many stores, one deployment (P1)
One web process + one worker process + one Postgres serve N stores. Every piece of state is keyed by `store_id`; no request, job, agent run, or webhook can read or write another tenant's data. Webhooks route by `merchant`. Each tenant keeps its own settings, agents config, memory, knowledge, reports, ledger, MCP token, and embed link.

### US3 — Per-tenant scheduled work (P1)
Each active tenant gets a daily analysis at its preferred local time (jittered), executed by a worker pool from a Postgres-backed job queue with retries; impact measurements and curator runs become queued follow-up jobs. One running analysis per store; a global concurrency cap protects provider rate limits.

### US4 — Platform operator at fleet scale (P2)
The central panel becomes a fleet view: tenant list with plan/status/usage/cost, per-tenant detail (today's single-tenant view), lock/unlock, plan overrides, impersonate-for-support (audited), reconciliation alerts.

### US5 — Metered economics (P2)
Every LLM call records tokens per tenant to a usage ledger; plan quotas (analyses, chat, daily token budget) are enforced at the route/job level with graceful degradation; the operator sees COGS per tenant.

## Success criteria

- **SC-1 Isolation**: an automated two-tenant test proves zero cross-tenant reads/writes through every API surface (dashboard, MCP, webhooks, jobs).
- **SC-2 Parity**: all behaviors in docs/VERIFICATION.md pass unchanged for a single tenant on the new storage (the existing test suite, parameterized by tenant).
- **SC-3 Lifecycle**: install → trial → subscribe → past-due → locked → reactivate → uninstall → reinstall-within-90d walked end-to-end against simulated Salla webhooks, with correct service gating at each state.
- **SC-4 Scheduling**: 50 simulated tenants with mixed timezones each get exactly one daily job per day; a killed worker's job is reclaimed and retried; per-store and global concurrency caps hold.
- **SC-5 Migration**: a single-store `DATA_DIR` imports into a tenant with full history (reports, memory, ledger, chats) byte-equivalent through the API.
- **SC-6 Metering**: every LLM call lands in the usage ledger with tenant, tokens, and kind; quota exhaustion degrades per the plan matrix instead of erroring.

## Constraints & decisions (locked in docs/saas/README decision table)

Shared-schema Postgres tenancy (`store_id` column, RLS as second wall) · Salla billing as the only rail at launch · platform-owned OpenRouter key with per-tenant metering (BYOK on top tier) · Postgres-backed job queue (SKIP LOCKED), no Redis · the agent system's logic does not change — it receives a tenant context.

## Out of scope for this feature

Zid adapter, storefront customer agent, Stripe, mobile PWA, team accounts (all remain in docs/ROADMAP.md).
