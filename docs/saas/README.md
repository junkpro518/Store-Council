# SaaS Conversion — Documentation Index

This folder is the complete blueprint for converting Store Council from a single-store deployment into a **multi-tenant SaaS sold as a monthly subscription** through the Salla App Store.

## Reading order

| # | Document | Contents |
|---|---|---|
| 1 | [01-overview.md](01-overview.md) | Goals, target model, what changes vs. what stays, conversion phases at a glance |
| 2 | [02-architecture.md](02-architecture.md) | Multi-tenant architecture: tenancy model, request scoping, the storage swap, scheduler redesign, job queue |
| 3 | [03-database.md](03-database.md) | Full PostgreSQL schema (every current JsonStore mapped to a table), indexes, row-level isolation |
| 4 | [04-billing.md](04-billing.md) | Plans & pricing, Salla App Store subscription billing, webhook lifecycle, grace periods, plan gating matrix |
| 5 | [05-auth-and-tenancy.md](05-auth-and-tenancy.md) | Merchant accounts, identity via Salla, sessions, integration tokens, per-tenant security boundaries |
| 6 | [06-migration-plan.md](06-migration-plan.md) | File-by-file code migration mapped to the current repo, in safe steps that keep tests passing |
| 7 | [07-operations.md](07-operations.md) | Unit economics (token-cost model per store), infrastructure sizing, monitoring, backups, support |
| 8 | [08-rollout.md](08-rollout.md) | Phased rollout: pilot → beta → GA, migrating existing single-store customers, risk register |

## The conversion in one paragraph

The current codebase was deliberately built for this: **all state flows through one abstraction (`src/store/jsonStore.ts`)**, every Salla webhook already carries `merchant`, settings are runtime data rather than environment config, and Easy Mode install already provisions a store with zero manual steps. Conversion means: (1) replace `JsonStore` with a Postgres-backed store keyed by `store_id`, (2) thread a tenant context through the request path and the agent runner, (3) replace the single cron with a per-tenant job scheduler/queue, (4) add the subscription layer on Salla's billing webhooks with plan gating, and (5) centralize the AI keys (platform-owned, metered per tenant) instead of each owner pasting their own. The agent system — definitions, tools, prompts, memory, board, playbooks, curator, impact loop, MCP — is **unchanged in logic**; it just receives a `storeId` everywhere it currently assumes one store.

## Decision summary (made in this blueprint, changeable)

| Decision | Choice | Alternative considered |
|---|---|---|
| Tenancy model | Shared app + shared Postgres, `store_id` column isolation | Container-per-tenant (kept as "dedicated" enterprise tier) |
| Database | PostgreSQL (or Supabase for speed) | Keep JSON files per tenant (rejected: locking, backup, query needs) |
| Billing | Salla App Store paid-plans (recurring) as primary; Stripe optional for direct sales | Stripe-only (rejected: friction inside Salla ecosystem) |
| AI keys | Platform-owned keys, usage metered per tenant, cost gates per plan | BYO-key (kept as an option on the top tier to offload cost) |
| Job execution | In-process worker pool + Postgres-backed queue table | Redis/BullMQ (fine too; one less moving part without it) |
| Merchant login | Salla OAuth identity (login-with-Salla) + email/password fallback | Magic links |
