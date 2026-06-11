# Roadmap — Proposed Future Features

Prioritized proposals for evolving Store Council. Phases are ordered by value-to-effort; items within a phase are independent.

## Phase 1 — Deepen the daily value (low effort, high impact)

| Feature | Description | Notes |
|---|---|---|
| **Report delivery channels** | Send the daily report summary by email and WhatsApp/Telegram so the owner doesn't have to open the dashboard. | SMTP + WhatsApp Business API / Telegram bot. Settings page already has the structure for new sections. |
| **Action outcome measurement** | When an action is marked *done*, schedule an automatic 14-day follow-up where the owning manager re-pulls the metric cited in *Why* and reports the measured impact. | Closes the loop; the strongest retention feature. Store `measuredAt`/`result` on the action item. |
| **Event-triggered alerts** | Let webhook events trigger immediate mini-analyses: a 1-star review pings the Reputation Manager; an abandoned high-value cart pings the Conversion Manager. Owner configures thresholds per event type. | The webhook feed already exists; add rules + a notifications panel. |
| **Weekly & monthly digests** | A GM-written weekly retrospective (what improved, what was implemented, KPI deltas) and a monthly strategy letter from the Growth Strategist. | Reuses the pipeline with a different brief + period. |
| **Report export** | Download any report as PDF (print-ready Arabic RTL layout) for sharing with staff/partners. | Client-side print stylesheet first; server-side PDF later. |

## Phase 2 — Smarter agents

| Feature | Description | Notes |
|---|---|---|
| **Historical memory** | Persist key metrics per day (orders, revenue, AOV, conversion proxies) into a local time series so agents compare against real history instead of re-deriving it, and can chart trends. | Adds a `metrics` store + a `metrics_history` tool for all agents. |
| **Agent memory of decisions** | Managers remember what they already recommended and what the owner dismissed, and stop repeating rejected advice. | Feed action statuses back into the daily brief. |
| **Owner goals & OKRs** | Owner sets explicit goals (e.g. "AOV 250 SAR by Q3"); every manager weighs recommendations against them; the GM reports progress. | Extends settings + prompts. |
| **Cross-store benchmarks (opt-in)** | Anonymous aggregate benchmarks ("your cart-abandonment is in the bottom quartile for fashion stores") once multiple deployments exist. | Requires a central opt-in service; privacy-first design. |
| **Deep-dive mode** | "Investigate شحن الرياض" — a long-running task where one manager does an exhaustive multi-step investigation and produces a standalone report. | Async job + progress UI; reuse `/reports/status` pattern. |

## Phase 3 — Productization & scale

| Feature | Description | Notes |
|---|---|---|
| **Multi-tenant SaaS mode** | One deployment, many stores: replace `JsonStore` with Postgres/Supabase, key all stores by merchant id, add store switcher + billing. | The storage layer was deliberately isolated to make this the only structural change. Salla webhooks already carry `merchant`. |
| **Subscription billing** | Handle Salla's `app.subscription.started/renewed/expired` webhooks to gate features by plan (e.g. number of enabled managers, analyses per day). | Required for paid App Store listing; webhook plumbing exists. |
| **Team accounts** | Multiple logins with roles (owner, staff-read-only) so employees can see the report and chat without settings access. | Extend the session store with roles. |
| **Mobile PWA** | Installable app + push notifications for the daily report and alerts. | Manifest + service worker on the existing SPA. |
| **Platform adapters** | Abstract the Salla client behind a provider interface and add Zid (and later Shopify) adapters — same council, other platforms. | The agent layer is already platform-agnostic except endpoint names. |

## Phase 4 — Beyond advice (requires explicit opt-in & write scopes)

The read-only contract is a core trust feature, so any write capability must be a separate, clearly-consented mode:

| Feature | Description | Notes |
|---|---|---|
| **One-click apply (draft mode)** | For supported actions (e.g. fixing a product description, creating a coupon), the manager prepares the exact change and the owner approves it in the dashboard; only then is it written via the Salla API. | Requires write scopes, a change journal, and undo. Keep default deployments read-only. |
| **Campaign composer** | The Marketing Manager drafts complete campaigns (audience, coupon, creative copy in Arabic) ready to paste — later, to apply via draft mode. | Pure-text version is Phase 1-easy; apply version belongs here. |

## Technical debt / hardening backlog

- Automated test suite (unit tests for allowlist/webhook verification/settings clamps; an integration test with a mocked Salla API and a stub LLM).
- Structured logging (pino) with per-run analysis traces and token-cost accounting per report.
- Rate limiting on all API routes (currently only login) and request size limits per route.
- i18n extraction of the dashboard strings into JSON files to ease adding languages.
- Streaming chat responses (SSE) for a more responsive chat UI.
