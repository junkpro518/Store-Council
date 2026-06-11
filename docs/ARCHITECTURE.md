# Architecture

## Overview

Store Council is a single-tenant Node.js/TypeScript application. One deployment serves one Salla store. It has four subsystems:

```
┌────────────────────────────────────────────────────────────────────┐
│                          Express server                            │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │
│  │ Owner auth   │  │ Salla layer   │  │ Agent system             │ │
│  │ (sessions)   │  │ OAuth/EasyMode│  │ 15 agents + 2 providers  │ │
│  └──────┬───────┘  │ GET-only API  │  └────────────┬─────────────┘ │
│         │          │ Webhooks      │               │               │
│  ┌──────▼──────────┴───────▲───────┴───────────────▼─────────────┐ │
│  │            JSON file storage (DATA_DIR, atomic writes)        │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  Static dashboard (public/) · Cron scheduler · Diagnostics         │
└────────────────────────────────────────────────────────────────────┘
```

## The agent system

### Roster

`src/agents/definitions.ts` defines 15 agents: a **General Manager** (orchestrator, id `gm`, cannot be disabled) and **14 specialists** (catalog, pricing, marketing, seo, cro, customer-service, retention, orders, shipping, inventory, finance, reviews, payments, growth). Each definition carries:

- an expert persona and standing **focus areas**,
- the **Salla endpoints** its `salla_read` tool may access (department-scoped),
- Arabic + English display names.

Owner customizations (rename, custom instructions, focus replacement, enable/disable) are stored in settings and resolved by `effectiveAgent()` — definitions in code are never mutated.

### Tools (`src/agents/tools.ts`)

Tools use a **provider-neutral format**: JSON-Schema parameters + an async `run` implementation. Every agent gets seven:

| Tool | Purpose | Guardrails |
|---|---|---|
| `salla_read` | Read store data | Department endpoint scope → global GET-only allowlist → OAuth read scopes |
| `consult_agent` | Ask a colleague (pairwise inter-agent communication) | Self-consult blocked; disabled colleagues refused; depth limit 2 prevents loops |
| `council_board` | Read/post the team's shared blackboard during a session | Posts capped (length + count); agents read colleagues' notes, not their own |
| `read_playbook` | Load a domain playbook in full (progressive disclosure) | Department-scoped access |
| `save_memory` | Persist a lesson/fact/feedback to long-term memory | Typed, length-capped, per-agent cap 60 |
| `metrics_history` | The store's daily KPI time series | Read-only, capped at 365 days |
| `calculate` | Exact arithmetic for metrics | Expression whitelist (digits and `+-*/%().` only) |

Large API payloads are clipped to ~24k characters before entering model context, with a hint to narrow the query.

### Learning system (memory + curator)

Adopted from Hermes Agent's closed learning loop:

- **Memory** (`src/agents/memory.ts`) — per-agent long-term memory with three sources: agent-saved **lessons/facts** (`save_memory`), and automatic **feedback** written whenever the owner marks an action *done* or *dismissed* — so managers stop repeating rejected advice and reinforce what worked. The newest ~20 items are injected into every system prompt (prefetch); the owner can inspect and delete any memory from the Managers page.
- **Curator** (`src/pipeline/curator.ts`) — a background maintenance pass (auto-triggered after a daily run when >7 days since the last one; also `POST /curator/run`). It has the LLM rewrite each agent's memory: merging duplicates, dropping superseded/expired items, tightening wording — never inventing. Degenerate results (everything dropped) are rejected as a safety valve.

### Team operation

- **Council board** (`src/agents/board.ts`) — a shared blackboard reset at the start of each daily session. Specialists post headline findings as they discover them and read colleagues' notes before finalizing (a sales drop and a courier-delay finding meet on the board). The GM consolidates from the board plus the full findings.
- **Pairwise consultation** (`consult_agent`) remains for targeted questions.

### Knowledge system (playbooks)

`skills/*.md` are domain playbooks in the SKILL.md format (YAML frontmatter: `name`, `description`, `agents`). Following progressive disclosure, agents see only the name+description index in their prompt and load full bodies on demand via `read_playbook`. Shipped playbooks: shared methodology and Salla-data guide (all agents) plus pricing, Arabic SEO, CRO/checkout, retention/RFM, the KSA commerce calendar, and inventory health. Add a playbook by dropping a new `.md` file in `skills/`.

### Metrics time series

`src/pipeline/metrics.ts` captures a daily KPI snapshot (orders/customers/products/abandoned-carts totals — one cheap pagination-metadata call each) at the start of every analysis. Agents query it via `metrics_history` to detect real trends instead of re-deriving history from raw API pages.

### Agent personas

Each agent's prompt now also carries **critical rules** — red lines it never crosses (e.g. Pricing never recommends a discount without margin math; Reviews never suggests fake reviews) — a personality-driven specialization pattern that sharpens domain behavior.

### Runner (`src/agents/runner.ts`)

`runAgent(agentId, question, depth, history)` builds the system prompt + tools and executes an agentic loop on the **selected provider**:

- **Anthropic** (default): Messages API manual loop — adaptive thinking, prompt-cached system block, `tool_use`/`tool_result` rounds, `pause_turn` handling, 20-iteration cap.
- **OpenRouter**: OpenAI-compatible `chat/completions` loop with function calling against any tool-capable model on openrouter.ai.

The system prompt (`src/agents/prompts.ts`) is deterministic for a given settings state (no timestamps), so Anthropic prompt caching works. It embeds: persona, focus areas, the owner's store context, the owner's custom instructions, the enabled-colleague roster, the read-only contract, the four-part recommendation format (What / Why with numbers / How in the Salla dashboard / Expected impact), and the language policy.

### Daily pipeline (`src/pipeline/daily.ts`)

1. All **enabled** specialists run in parallel (configurable concurrency, default 4) on a standing daily brief: pull data, compare to the last 30 days, produce top-3 findings, consult colleagues when needed.
2. The **General Manager** consolidates all findings into an executive summary, a ranked top-N action list (resolving inter-department conflicts), and a watchlist.
3. A structured-output extraction pass converts the report into **action items** (`title/manager/what/why/how/impact/priority`) that the owner can mark done/dismissed.
4. The report is persisted; one report per date (re-runs replace).

Failures in one agent never abort the run — they are recorded as `(analysis failed: …)` in that department's slot.

## Salla layer

- **`auth.ts`** — two connection paths: manual OAuth (authorize → callback → token exchange) and **Easy Mode** (Salla App Store pushes tokens via the `app.store.authorize` webhook). Tokens auto-refresh 60s before expiry. `connectionInfo()` reports the mode + merchant id.
- **`client.ts`** — the read-only enforcement point: only `GET`, only allowlisted endpoints (regex-matched, `{id}` patterns supported), bounded 429 backoff (≤3 retries, header-driven), bounded pagination (`sallaGetAll`, ≤10 pages × 50).
- **`webhooks.ts`** — HMAC-SHA256 verification (`x-salla-signature` over the raw body, timing-safe compare); handles lifecycle events (`app.store.authorize`, `app.uninstalled`) and logs store events (orders, products, reviews…) to a capped feed (200).
- **`storeInfo.ts`** — cached store identity (12h TTL) for the dashboard header; stale-on-error.

## Security model

| Layer | Mechanism |
|---|---|
| Owner access | First-run password setup, scrypt-hashed; 30-day bearer sessions; password change revokes all sessions; login lockout (5 fails → 10 min/IP) |
| Store write-protection | OAuth read scopes + GET-only allowlisted client + per-agent endpoint scope + prompt-level contract |
| Webhooks | HMAC-SHA256 signature required; unsigned/invalid → 401 |
| HTTP | `X-Frame-Options: DENY`, `nosniff`, no referrer, no `x-powered-by`; JSON-only error responses |
| Storage | Atomic writes (temp file + rename); secrets only in `DATA_DIR` |

## Storage

`src/store/jsonStore.ts` is the single persistence abstraction — file-backed JSON with atomic writes. Stores: `settings`, `auth`, `salla-tokens`, `store-info`, `webhook-events`, `daily-reports`, `chat-history`. Swapping this module for a database is the only change needed for a future multi-tenant version.

## Runtime configuration

Everything the owner can change lives in `src/settings/settings.ts` and is editable from the dashboard: AI provider (Anthropic/OpenRouter) + keys + models, language policy, store context, schedule (cron + timezone, applied live), concurrency, report depth, Salla credentials + webhook secret, per-agent overrides. Environment variables are only initial defaults; `PORT` and `DATA_DIR` are the only server-level settings.
