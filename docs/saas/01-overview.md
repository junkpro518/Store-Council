# 01 — Overview: From Single-Store Product to Subscription SaaS

## Goal

One hosted platform serving many Salla stores, each paying a **monthly subscription** through the Salla App Store. A merchant installs the app from the App Store, gets connected automatically (Easy Mode — already built), picks a plan, and their personal AI council starts working the next morning. No deployment, no API keys, no server — for them.

## What the merchant experience becomes

1. Install from the Salla App Store → store connects automatically (`app.store.authorize` webhook, already implemented).
2. First report runs free (trial) → the "aha" moment before payment.
3. Choose a plan inside Salla's billing flow (Salla handles payment, VAT, invoices).
4. Use the same dashboard as today — except login is per-merchant and there is a plan/usage card.
5. Cancel any time → `app.subscription.expired` webhook downgrades/locks the tenant; data retained 90 days.

## What stays exactly the same (the protected core)

The agent system is the product and **does not change in logic**:

- 15 agent definitions, personas, critical rules (`src/agents/definitions.ts`, `prompts.ts`)
- Provider-neutral tools and both agent loops (`tools.ts`, `runner.ts`)
- Learning system: memory, feedback hook, curator
- Team system: council board, consultations
- Playbooks (`skills/`), metrics history, impact-measurement loop, achievement ledger
- The Salla read-only client and its three-layer write protection
- The dashboard UI (gains a plan card and loses the AI-key fields)
- The MCP server (becomes per-tenant)

## What changes

| Area | Today (single-store) | SaaS |
|---|---|---|
| State | JSON files in `DATA_DIR`, one store implied | PostgreSQL, every row keyed by `store_id` |
| Identity | One owner password | Merchant accounts (login with Salla), one account ↔ one or more stores |
| AI keys | Owner pastes their own Anthropic/OpenRouter key | Platform-owned keys; usage metered and gated per plan (BYO-key allowed on top tier) |
| Scheduler | One `node-cron` task | Job queue: one daily-analysis job per tenant, spread across a time window, with concurrency control |
| Billing | None (one-time sale) | Salla App Store recurring plans + subscription webhooks |
| Webhooks | Implicitly for "the" store | Routed by `merchant` id to the right tenant (payload already carries it) |
| Settings | Global `settings.json` | Per-tenant settings row (same shape minus AI keys) |
| MCP/integration token | One token | Per-tenant tokens |
| Ops | Customer's server | Our infrastructure: monitoring, backups, cost tracking per tenant |

## Why the current architecture makes this cheap

Three deliberate decisions from the original build pay off now:

1. **Single storage abstraction** — every read/write in the codebase goes through `JsonStore<T>` (7 call sites own all state: settings, auth, salla-tokens, store-info, webhook-events, daily-reports, chat-history, agent-memory, council-board, metrics-history, curator-state). Conversion = reimplement one class against Postgres with a `storeId` dimension, then thread the id.
2. **Webhooks already carry `merchant`** — multi-tenant routing of Salla events is a lookup, not a redesign.
3. **Settings are runtime data, not env config** — per-tenant settings are the same object in a table instead of a file.

## Conversion phases (detail in 06 + 08)

| Phase | Outcome | Rough effort |
|---|---|---|
| **P0 — Foundations** | Postgres schema + `TenantStore` replacing `JsonStore`; everything still single-tenant ("default" tenant) and all tests pass | 1–2 weeks |
| **P1 — Tenancy** | Tenant context through server/agents/pipeline; webhook routing by merchant; per-tenant MCP tokens | 1–2 weeks |
| **P2 — Accounts & billing** | Login-with-Salla, plans, Salla subscription webhooks, gating, plan/usage UI | 2 weeks |
| **P3 — Scale & ops** | Job queue for daily runs, per-tenant cost metering, monitoring, backups, rate limits | 1–2 weeks |
| **P4 — Rollout** | Pilot stores → beta → App Store GA; migrate existing single-store customers | ongoing |

Total: roughly **6–8 weeks** of focused work to GA-ready.

## Non-goals of this conversion

- No rewrite of the agent layer, providers, or UI framework.
- No Kubernetes/microservices — one Node app + Postgres + a worker process scales past the first thousand stores (see 07).
- No Stripe at launch — Salla billing first; Stripe only if/when selling outside the Salla ecosystem.
