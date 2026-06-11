# Store Council — AI Advisory Platform for Salla Stores

A multi-agent AI platform that connects to a merchant's **Salla** store in strict **read-only** mode, analyzes every aspect of the store **automatically every day**, and delivers expert recommendations with **step-by-step Salla-dashboard implementation instructions**. Each agent is a specialist "department manager" the store owner can **chat with directly**, and managers **consult each other** when a finding crosses departments.

> The platform never modifies the store. It observes, analyzes, recommends, and explains — the merchant always executes the changes.

## The Council (1 orchestrator + 14 specialist managers)

| ID | Manager | Domain |
|---|---|---|
| `gm` | General Manager (المدير العام) | Orchestrates, prioritizes, resolves conflicts, writes the daily report |
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

Each agent has:
- An **expert persona** with standing analysis focus areas (`src/agents/definitions.ts`).
- A **`salla_read` tool** scoped to its department's endpoints only (read-only, allowlisted at two layers — see `src/salla/client.ts`).
- A **`consult_agent` tool** for inter-agent communication (depth-limited to prevent loops).
- A **`calculate` tool** for exact metrics (AOV, rates, deltas).

Agents run on **Claude Opus 4.8** with adaptive thinking via the Anthropic SDK tool runner.

## How it works

```
Salla store ──OAuth (read-only)──▶ Salla client (GET-only allowlist)
                                        │ salla_read tool
                                        ▼
        ┌──────── 14 specialist managers (parallel, daily cron) ────────┐
        │  each: pull data → analyze → consult colleagues → top-3 recs  │
        └──────────────────────────┬─────────────────────────────────────┘
                                   ▼
        General Manager consolidates → daily report (top-5 actions,
        each with What / Why-with-numbers / How-in-Salla-dashboard / Impact)
                                   ▼
        Owner reads the report and chats with any manager for details
```

## Setup

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY + Salla app credentials
npm install
npm run dev            # starts the API server + daily cron
```

1. Create an app in the [Salla Partners portal](https://salla.partners), set the callback URL to `SALLA_REDIRECT_URI`, and request **read-only scopes only**.
2. Open `http://localhost:3000/auth/salla` and approve the app on the store.
3. Trigger a first analysis: `curl -X POST localhost:3000/reports/run` (or wait for the daily cron, default 05:00).

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + store-connection status |
| `GET` | `/auth/salla` → callback | Connect a store via OAuth |
| `GET` | `/agents` | List the council |
| `POST` | `/agents/:id/chat` `{message}` | Chat with a manager (it pulls live store data as needed) |
| `GET/DELETE` | `/agents/:id/chat` | Read / reset a chat history |
| `POST` | `/reports/run` | Run the full daily analysis now |
| `GET` | `/reports` / `/reports/:date` | List / read daily reports |

Example — ask the Pricing Manager something (Arabic or English both work):

```bash
curl -X POST localhost:3000/agents/pricing/chat \
  -H 'content-type: application/json' \
  -d '{"message": "هل أسعار منتجاتي الأكثر مبيعاً مناسبة؟"}'
```

## Read-only enforcement (three layers)

1. **OAuth scope** — request only read scopes when registering the Salla app.
2. **API client** — `src/salla/client.ts` can only issue `GET` against an explicit endpoint allowlist; there is no code path for writes.
3. **Agent tools** — each agent's `salla_read` is further scoped to its own department's endpoints; system prompts forbid claiming any change was made.

## Project layout

```
src/
  agents/definitions.ts   # the 15-agent roster: personas, endpoints, focus areas
  agents/prompts.ts       # cacheable system-prompt builder
  agents/tools.ts         # salla_read / consult_agent / calculate (Zod tools)
  agents/runner.ts        # Claude tool-runner loop per agent
  salla/auth.ts           # OAuth (authorize, exchange, refresh)
  salla/client.ts         # GET-only allowlisted Salla Admin API client
  pipeline/daily.ts       # parallel daily analysis + GM consolidation
  chat/chatStore.ts       # per-agent chat history
  server.ts               # Express API + cron scheduler
  store/jsonStore.ts      # file-backed storage (swap for a DB in production)
```

## Roadmap

- Multi-tenant storage (Postgres/Supabase) and per-store token isolation
- Salla webhooks for near-real-time alerts between daily runs
- Web dashboard (Arabic-first) for reports and chat
- Recommendation lifecycle tracking (proposed → implemented → measured impact)
