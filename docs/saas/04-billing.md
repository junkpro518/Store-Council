# 04 — Plans, Pricing & Salla Subscription Billing

## Plan structure

Gates map to capabilities that already exist in the codebase, so enforcement is configuration, not new features. Prices are launch hypotheses — validate in pilot (08); all prices SAR/month, billed through Salla.

| | **Basic** ~99 | **Pro** ~249 | **Growth** ~449 | **BYOK/Dedicated** (custom) |
|---|---|---|---|---|
| Enabled managers | 5 (owner picks) | All 15 | All 15 | All 15 |
| Daily scheduled analysis | ✔ | ✔ | ✔ | ✔ |
| On-demand analyses /mo | 2 | 15 | 60 | unlimited |
| Chat messages /mo | 100 | 600 | 2,500 | unlimited |
| Model tier | Sonnet-class | Opus-class | Opus-class | choice |
| Memory & learning, playbooks | ✔ | ✔ | ✔ | ✔ |
| Impact measurement & ledger | — | ✔ | ✔ | ✔ |
| MCP connector (Claude/ChatGPT) | — | — | ✔ | ✔ |
| Event alerts (future) | — | — | ✔ | ✔ |
| AI key | platform | platform | platform | merchant's own / dedicated deploy |

**Trial:** 7 days on Pro behavior (full council) with hard caps (1 scheduled + 1 on-demand analysis/day, 30 chat messages total). The first report is the conversion moment — never gate it.

Soft-landing on caps: when a monthly quota is exhausted, degrade gracefully (queue the request with an upgrade prompt), never hard-error mid-chat.

## Why Salla billing first

Salla App Store paid apps bill through the merchant's existing Salla account (their payment method, SAR pricing, VAT handled, one invoice). Zero checkout friction for the buyer; Salla takes a revenue share — acceptable as CAC. Stripe direct is added later only for off-marketplace sales (dedicated tier).

## Subscription lifecycle (webhooks)

Configure plans in the Salla Partners portal; Salla then emits subscription events to the existing webhook endpoint. Handle (exact event names per current Salla docs — verify at implementation time):

| Event | Handler |
|---|---|
| `app.subscription.started` | Upsert `subscriptions` row, map Salla plan → `plan`, set store `status='active'`, end trial |
| `app.subscription.renewed` | Update `renews_at`; clear `past_due` if set |
| `app.subscription.canceled` | Mark `canceled_at`; keep service until period end |
| `app.subscription.expired` | Store `status='past_due'` → 7-day grace (reports keep running, banner shown) → `locked` |
| `app.trial.started` / `app.trial.expired` | Set/end trial state (if the app uses Salla-managed trials; otherwise trial is internal) |
| `app.uninstalled` (existing) | Independent of billing: revoke tokens, retention countdown |

Rules:
- **Webhooks are the source of truth**; never flip plan state from UI actions alone. Store the raw payload in `subscriptions.raw` for dispute/audit.
- Idempotency: events can repeat — handlers must upsert, not insert.
- Reconciliation job (daily): compare local subscription states against the Salla API (if/where queryable) and alert on drift.

## Tenant states and what runs

| Store status | Daily analysis | Chat | Dashboard | Data |
|---|---|---|---|---|
| `trial` | ✔ (capped) | ✔ (capped) | ✔ | ✔ |
| `active` | per plan | per plan | ✔ | ✔ |
| `past_due` (grace ≤7d) | ✔ + banner | ✔ + banner | ✔ | ✔ |
| `locked` | ✗ | ✗ | read-only: old reports + achievement ledger + reactivate CTA | retained |
| `uninstalled` | ✗ | ✗ | ✗ | retained 90d, then purged |

**The achievement ledger is the win-back asset:** locked tenants still see "the council generated +X SAR for you" next to the reactivate button.

## Enforcement points in code

| Gate | Where |
|---|---|
| Manager count / model tier | `effectiveAgents()` filter + model resolution take plan from tenant context |
| On-demand analyses, chat quota | middleware on `POST /reports/run` and `POST /agents/:id/chat` checks `usage_ledger` month-to-date |
| Impact loop, MCP | feature flags on plan in the respective route/job |
| Scheduled run | enqueuer skips `locked`/`uninstalled` tenants |

Define a single `PLAN_MATRIX` constant consumed by all gates — one place to tune plans.

## Token-cost guardrails (protects margin; details in 07)

- Per-tenant daily token budget by plan (e.g. Basic 1.5M, Pro 6M, Growth 20M tokens/day across all jobs); the runner checks the ledger before starting a job and trims (fewer agents per run / shorter briefs) rather than failing.
- Alert at 80% of budget; auto-throttle at 100%; support override flag for exceptional stores.

## Dashboard additions

- **Plan & usage card** (Settings): current plan, renewal date, month-to-date usage bars (analyses, chat, tokens as "energy"), upgrade button (deep-link to the Salla app page).
- **Locked screen**: ledger summary + reactivate.
- Remove from Settings: AI provider/key fields, Salla app credential fields (platform-level now). Keep: language, store context, schedule preferences (hour + timezone within allowed window), agent customization.
