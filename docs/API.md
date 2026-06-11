# API Reference

Base URL: your deployment origin. All endpoints return JSON.

**Authentication:** endpoints marked 🔒 require `Authorization: Bearer <token>` (obtained from `/auth/login` or `/auth/setup`). Browser navigations (`/auth/salla`) accept `?token=`.

## Health & status

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Liveness: `{ok:true}` |
| GET | `/auth/status` | — | `{setup, authenticated, storeConnected, provider, aiConfigured}` |

## Owner authentication

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/setup` | `{password}` | First run only; min 8 chars; returns `{token}` |
| POST | `/auth/login` | `{password}` | Returns `{token}` (30-day). 5 failures → 10-min lockout per IP (429) |
| POST | `/auth/logout` 🔒 | — | Revokes the presented token |
| POST | `/auth/change-password` 🔒 | `{current, next}` | Revokes **all** sessions |

## Salla connection

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/salla?token=…` | 🔒 | Redirects to Salla OAuth consent (manual connect) |
| GET | `/auth/salla/callback` | — | OAuth callback (state-checked); redirects to the dashboard |
| POST | `/salla/disconnect` | 🔒 | Forgets store tokens |
| GET | `/embed?k=…` | embed key | Salla-dashboard embed entry: valid key mints a session and redirects into the dashboard (invalid → 401). The merchant SPA is frame-embeddable by `*.salla.sa` only; `/admin*` never |
| GET / POST | `/auth/embed-link` · `/auth/embed-link/rotate` | 🔒 | Get / rotate the embed App-URL for the Salla Partners portal |
| POST | `/webhooks/salla` | HMAC | Salla webhook receiver. Requires valid `x-salla-signature` (HMAC-SHA256 of raw body with the webhook secret). Handles `app.store.authorize` (Easy Mode connect), `app.uninstalled` (disconnect), and logs store events |
| GET | `/store/summary` | 🔒 | `{connected, mode: "easy"\|"oauth", merchantId, name, domain, plan}`; `?refresh=1` bypasses the cache |
| GET | `/store/events` | 🔒 | Last 30 verified webhook events `[{event, merchant, receivedAt, summary}]` |

## Settings

| Method | Path | Description |
|---|---|---|
| GET | `/settings` 🔒 | Full settings object |
| PUT | `/settings` 🔒 | Partial update (deep-merged for `salla`, `openRouter`, `agents`). Invalid cron → 400. Schedule re-applied live |

Settings shape:

```json
{
  "provider": "openrouter",
  "openRouter": { "apiKey": "", "model": "openai/gpt-4o" },
  "language": "ar | en | auto",
  "storeContext": "",
  "dailyEnabled": true, "dailyCron": "0 5 * * *", "timezone": "Asia/Riyadh",
  "analysisConcurrency": 4, "topActionsCount": 5,
  "salla": { "clientId": "", "clientSecret": "", "redirectUri": "", "webhookSecret": "" },
  "agents": { "<id>": { "enabled": true, "displayName": "", "customInstructions": "", "focus": [] } }
}
```

## Agents

| Method | Path | Description |
|---|---|---|
| GET | `/agents` 🔒 | The council with effective config: `{id, name, defaultName, nameAr, title, expertise, focus, defaultFocus, endpoints, enabled, customInstructions, isOrchestrator}` |
| PUT | `/agents/:id/config` 🔒 | `{enabled?, displayName?, customInstructions?, focus?}`. The GM ignores `enabled:false` |
| POST | `/agents/:id/chat` 🔒 | `{message}` → `{agent, reply}`. 409 if agent disabled or store not connected. The agent pulls live store data and may consult colleagues while answering |
| GET | `/agents/:id/chat` 🔒 | `{agent, history:[{role, content}]}` (last 40 turns kept) |
| DELETE | `/agents/:id/chat` 🔒 | Clears that agent's history |

## Reports

| Method | Path | Description |
|---|---|---|
| GET | `/reports` 🔒 | `[{date, startedAt, finishedAt, actionCount, doneCount}]`, newest first |
| GET | `/reports/latest` 🔒 | Most recent full report |
| GET | `/reports/status` 🔒 | `{running}` — poll after starting a run |
| GET | `/reports/:date` 🔒 | Full report: `{date, summary, actions[], departments{}}` |
| POST | `/reports/run` 🔒 | Starts an analysis asynchronously (`{ok}` immediately; 409 if already running or store disconnected) |
| POST | `/reports/:date/actions/:index` 🔒 | `{status: "new"\|"done"\|"dismissed"}` → updated report |

Action item shape: `{title, manager, what, why, how, impact, priority, status}`.

## Knowledge base & questions

| Method | Path | Description |
|---|---|---|
| GET/POST | `/agents/:id/knowledge` 🔒 | List / add owner-provided documents for a manager (`:id` may be `all` for shared docs) |
| PUT/DELETE | `/agents/:id/knowledge/:docId` 🔒 | Edit / remove a document |
| GET | `/questions?status=pending\|answered\|dismissed` 🔒 | Managers' questions to the owner |
| POST | `/questions/:id/answer` `{answer}` 🔒 | Answer (written into the manager's memory) |
| POST | `/questions/:id/dismiss` 🔒 | Dismiss |

## Central panel (`/admin/*` — separate platform-owner credentials)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/auth/status` · POST `/admin/auth/setup` · `login` · `logout` | Admin auth (min 10-char password, 12h sessions, lockout). Merchant and admin tokens are not interchangeable |
| GET | `/admin/overview` | Tenant state, store identity, health, counts, agent fleet, curator |
| PUT | `/admin/platform` | `{plan: trial\|basic\|pro\|growth\|custom, status: active\|locked, notes}` — `locked` suspends all merchant APIs with 402 |
| POST | `/admin/curator/run` | Trigger memory curation |

## Change requests (write modes)

When the owner sets store edit permissions to `confirm` or `auto` (globally in Settings or per manager), agents gain a `salla_write` tool restricted to a conservative allowlist (POST/PUT on products, coupons, specialoffers, categories — no deletes, ever).

| Method | Path | Description |
|---|---|---|
| GET | `/changes?status=pending\|applied\|rejected\|failed` 🔒 | Change journal (all agent write attempts, audited) |
| POST | `/changes/:id/approve` 🔒 | Execute a pending change against the store; the agent learns from the approval |
| POST | `/changes/:id/reject` 🔒 | `{reason}` — reject; the reason is written into the agent's memory so it isn't re-proposed |

`PUT /settings` accepts `writeMode: "read_only"|"confirm"|"auto"`; `PUT /agents/:id/config` accepts `writeMode: "inherit"|…` per manager. The General Manager is always read-only.

## Achievements & impact

| Method | Path | Description |
|---|---|---|
| GET | `/achievements` 🔒 | The achievement ledger: every implemented action with `measuredAt`/`measuredImpact` (filled ~14 days after "done" by the impact-measurement loop) |

## MCP (connect the council to Claude/ChatGPT)

| Method | Path | Description |
|---|---|---|
| POST | `/mcp` 🔒 | Stateless Streamable-HTTP MCP endpoint. Authenticate with the **integration token** as a Bearer header. Tools: `list_managers`, `ask_manager`, `get_daily_report`, `list_reports`, `set_action_status`, `get_achievements`, `get_metrics_history` |
| GET | `/integration-token` 🔒 | Returns the long-lived integration token (created on first request) |
| POST | `/integration-token/rotate` 🔒 | Rotates it (disconnects existing MCP clients) |

## Diagnostics

| Method | Path | Description |
|---|---|---|
| GET | `/diagnostics` 🔒 | `{provider, ai:{ok,detail}, salla:{ok,detail}, webhookSecret, dailyEnabled}` — validates the active AI provider key and Salla connectivity live |

## Errors

All errors are JSON: `{error: "message"}` with appropriate status (400 validation, 401 auth/signature, 404 missing, 409 state conflict, 429 lockout/limits, 500 internal). Malformed JSON bodies also return JSON, never HTML.
