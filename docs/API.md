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
  "provider": "anthropic | openrouter",
  "anthropicApiKey": "", "model": "claude-opus-4-8",
  "openRouter": { "apiKey": "", "model": "anthropic/claude-sonnet-4.5" },
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

## Diagnostics

| Method | Path | Description |
|---|---|---|
| GET | `/diagnostics` 🔒 | `{provider, ai:{ok,detail}, salla:{ok,detail}, webhookSecret, dailyEnabled}` — validates the active AI provider key and Salla connectivity live |

## Errors

All errors are JSON: `{error: "message"}` with appropriate status (400 validation, 401 auth/signature, 404 missing, 409 state conflict, 429 lockout/limits, 500 internal). Malformed JSON bodies also return JSON, never HTML.
