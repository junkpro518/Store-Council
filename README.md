# مجلس المتجر — Store Council

**An AI management team for a Salla store.** The platform connects to one Salla store in strict **read-only** mode, analyzes every aspect of it **automatically every day**, and delivers expert recommendations with **step-by-step Salla-dashboard implementation instructions**. The owner can **chat directly with any of the 14 specialist AI department managers**, who also **consult each other** when a finding crosses departments.

Everything is controlled from a built-in, Arabic-first **web dashboard** — the owner never needs to touch code, config files, or the terminal. Agents run on **Anthropic** (default) or **OpenRouter** — the owner picks the provider and model in Settings.

> The platform never modifies the store. It observes, analyzes, recommends, and explains — the merchant always executes the changes.

## Documentation

| Doc | Contents |
|---|---|
| [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md) | Store-owner manual (with Arabic quick start) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design: agents, tools, providers, Salla layer, security |
| [docs/API.md](docs/API.md) | Full HTTP API reference |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deploy + Salla App Store listing checklist |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Proposed future features, phased |

---

## What the owner gets

- **Daily report** — every morning the full council analyzes the store in parallel; the General Manager consolidates everything into an executive summary plus a ranked, trackable action list. Each action carries *What / Why (with the store's own numbers) / How (exact dashboard steps) / Expected impact*, and can be marked **done** or **dismissed** from the dashboard.
- **Chat with every manager** — persistent, per-manager conversations in Arabic or English. Managers pull live store data while answering.
- **Full control without code** — from the dashboard the owner can:
  - set/change the Anthropic API key, model, and reply language,
  - write a free-text store profile every manager reads,
  - rename any manager, give it standing instructions, replace its focus areas, or disable it entirely,
  - change the daily schedule (cron + timezone), report depth, and parallelism,
  - configure Salla app credentials and connect/disconnect the store,
  - change the owner password.

## The Council (1 orchestrator + 14 specialists)

| ID | Manager | Domain |
|---|---|---|
| `gm` | General Manager (المدير العام) | Prioritizes, resolves conflicts, writes the daily report (cannot be disabled) |
| `catalog` | Catalog Manager | Product data quality, images, categories, merchandising |
| `pricing` | Pricing Manager | Price architecture, discounts, promotions, margins |
| `marketing` | Marketing Manager | Campaigns, coupons, affiliates, on-site ads |
| `seo` | SEO Manager | Metadata, content, Arabic/English keyword strategy |
| `cro` | Conversion Manager | Abandoned carts, funnel friction, product-page persuasion |
| `customer-service` | Customer Service Manager | Questions, complaints, response gaps |
| `retention` | Retention Manager | RFM segments, repeat purchase, win-back, loyalty |
| `orders` | Operations Manager | Fulfillment speed, cancellations, status hygiene |
| `shipping` | Logistics Manager | Courier performance, shipping costs, coverage |
| `inventory` | Inventory Manager | Stockouts, dead stock, reorder points |
| `finance` | Finance Manager | Revenue/AOV trends, settlements, fees, taxes |
| `reviews` | Reputation Manager | Review coverage, negative-review themes |
| `payments` | Payments Manager | Mada/Apple Pay/BNPL/COD mix, failed transactions |
| `growth` | Growth Strategist | KPIs, assortment gaps, strategic priorities |

Each agent has an expert persona **with critical rules** (red lines it never crosses) and seven tools: department-scoped `salla_read`, `consult_agent` (pairwise teamwork), `council_board` (the team's shared blackboard during daily sessions), `read_playbook` (domain field guides in SKILL.md format, loaded on demand), `save_memory`, `metrics_history` (the store's real KPI time series), and `calculate`. The agentic loop runs on the owner-selected provider: **Anthropic** (Claude Opus 4.8 with adaptive thinking, default) or **OpenRouter** (any tool-calling model).

**Accountability and reach.** Implemented recommendations get their real impact **measured automatically ~14 days later** (the owning manager re-pulls the metric it cited) and land in the dashboard's **achievement ledger** — receipts, not just advice. And the platform is an **MCP server** (`/mcp`): merchants can talk to *their own council* — with its memory, specialists, and reports — from inside Claude, ChatGPT, or any MCP-capable client, using the integration token from Settings.

**The council learns.** Every manager keeps long-term memory: lessons it saves itself, durable store facts, and automatic feedback whenever the owner implements or dismisses a recommendation — rejected advice isn't repeated, accepted directions are reinforced. A background **curator** periodically cleans each memory (merging duplicates, dropping stale items), and the owner can inspect or delete any memory from the dashboard.

## Architecture

```
Salla store ──OAuth (read-only)──▶ Salla client (GET-only allowlist)
                                        │ salla_read tool
                                        ▼
        ┌──────── enabled specialist managers (parallel, daily cron) ───────┐
        │  each: pull data → analyze → consult colleagues → top-3 recs      │
        └──────────────────────────┬──────────────────────────────────────────┘
                                   ▼
        General Manager consolidates → structured action items (tracked
        done/dismissed) + executive summary
                                   ▼
        Owner dashboard: report, action checklist, chat, full settings
```

## Quick start

```bash
npm install
npm run dev        # development (tsx)
# or production:
npm run build && npm start
```

Then open `http://localhost:3000` and follow the dashboard:

1. **First run** — set the owner password.
2. **Settings → AI** — paste your Anthropic API key (console.anthropic.com).
3. **Settings → Salla** — create an app in the [Salla Partners portal](https://salla.partners) with **read-only scopes**, set its callback URL to `http://<your-host>:3000/auth/salla/callback`, paste the Client ID/Secret, and click **Connect store**.
4. **Dashboard → Run analysis now** for the first report, or wait for the daily schedule (default 05:00 Asia/Riyadh).

No environment variables are required; `.env.example` lists optional server-level overrides (port, data directory) and initial defaults.

## API (all owner-authenticated unless noted)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness (public) |
| `GET` | `/auth/status` | Setup/auth/connection state (public) |
| `POST` | `/auth/setup` · `/auth/login` · `/auth/logout` · `/auth/change-password` | Owner auth |
| `GET` | `/auth/salla` → `/auth/salla/callback` | Connect the store via OAuth |
| `POST` | `/salla/disconnect` | Disconnect the store |
| `GET/PUT` | `/settings` | Read / update all platform settings (reschedules cron live) |
| `GET` | `/agents` | The council with effective (owner-customized) config |
| `PUT` | `/agents/:id/config` | Enable/disable, rename, instructions, focus areas |
| `POST/GET/DELETE` | `/agents/:id/chat` | Chat with a manager / history / reset |
| `GET` | `/reports` · `/reports/latest` · `/reports/:date` · `/reports/status` | Daily reports |
| `POST` | `/reports/run` | Start an analysis now (async; poll `/reports/status`) |
| `POST` | `/reports/:date/actions/:index` | Mark an action `done` / `dismissed` / `new` |

## Salla App Store listing

The platform implements everything Salla requires from a listed app:

- **Webhook endpoint** — `POST /webhooks/salla`, with **HMAC-SHA256 signature verification** (`x-salla-signature` over the raw body). Unsigned or invalid deliveries are rejected with 401.
- **Easy Mode authorization** — when a merchant installs the app from the App Store, Salla pushes tokens via the `app.store.authorize` event; the platform stores them and connects automatically (no OAuth redirect needed). Manual OAuth remains available for development/custom installs.
- **Lifecycle events** — `app.installed` is logged; `app.uninstalled` disconnects the store and clears the cached identity immediately.
- **Store events feed** — `order.created`, `product.updated`, `review.added`, `abandoned.cart`, etc. are verified, summarized, and shown on the dashboard (last 200 kept).

**Listing checklist (Partners portal → your app):**

1. Set the **Webhook URL** to `https://<your-host>/webhooks/salla` and choose the **signature** security strategy; copy the secret into *Dashboard → Settings → Webhook secret*.
2. Subscribe the app to at least: `app.store.authorize`, `app.installed`, `app.uninstalled` (plus any store events you want in the feed).
3. Request **read-only scopes only** — the app never writes to stores, which simplifies review.
4. Set the OAuth callback URL to `https://<your-host>/auth/salla/callback` (used for non-App-Store installs).
5. Deploy behind **HTTPS** with a stable domain before submitting for review.

Use *Settings → System check* to verify the Anthropic key, Salla connectivity, and webhook secret before submission.

## Read-only enforcement (three layers)

1. **OAuth scope** — register the Salla app with read-only scopes.
2. **API client** — `src/salla/client.ts` can only issue `GET` against an explicit endpoint allowlist; no write code path exists.
3. **Agent tools** — each agent's `salla_read` is further scoped to its own department's endpoints; system prompts forbid claiming any change was made.

## Project layout

```
public/                   # owner dashboard (Arabic-first SPA, no build step)
src/
  agents/definitions.ts   # 15-agent roster + owner-override resolution
  agents/prompts.ts       # system prompts (language policy, store context, overrides)
  agents/tools.ts         # salla_read / consult_agent / calculate
  agents/runner.ts        # Claude tool-runner loop per agent
  auth/owner.ts           # owner password + session tokens (scrypt)
  chat/chatStore.ts       # per-agent chat history
  llm/client.ts           # Anthropic + OpenRouter clients from runtime settings
  pipeline/daily.ts       # parallel analysis + GM consolidation + action extraction
  salla/auth.ts           # OAuth + Easy Mode tokens (authorize, exchange, refresh)
  salla/client.ts         # GET-only allowlisted Salla Admin API client
  salla/webhooks.ts       # signature verification, lifecycle + event feed
  salla/storeInfo.ts      # cached store identity for the dashboard header
  server.ts               # Express API + dashboard hosting + cron scheduler
  settings/settings.ts    # runtime settings (everything the owner can change)
  store/jsonStore.ts      # file-backed storage under DATA_DIR
```

## Operations notes

- **State** lives in `DATA_DIR` (default `./data`): settings, owner auth, Salla tokens, reports, chat history. Back up this folder; deleting it factory-resets the platform.
- **Deploy** behind HTTPS (the owner token and API keys travel over this connection). Any Node 20+ host works: `npm run build && npm start`.
- **Selling to more stores later**: each customer gets their own deployment (one container + one data dir per store). The storage layer is isolated behind `JsonStore`, so a future multi-tenant version only needs to swap that module for a database.
