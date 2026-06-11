# 07 — Operations: Unit Economics, Infrastructure, Monitoring

## Unit economics (the number that decides pricing)

Cost per store ≈ daily analysis + chat + background loops. Model it per plan before fixing prices; the formula (tokens × provider rates):

```
daily_analysis ≈ Σ over enabled agents (system prompt + tool rounds) + GM consolidation + extraction
```

Working assumptions to validate in pilot (measure with usage_ledger, don't trust estimates):
- A specialist's daily run: ~15–40k input tokens (prompt caching cuts repeat system-prompt cost sharply within a run) + 1–3k output.
- 14 specialists + GM + extraction ⇒ order of **300–700k input / 30–60k output tokens per daily run** on Opus-class; roughly 2.5–5 SAR/day at current Opus rates, ~5× cheaper on Sonnet-class.
- Chat: 10–50k input per message depending on tool use.

Consequences already baked into the plan design (04):
- Basic runs Sonnet-class and 5 agents → COGS well under 1 SAR/day → healthy at 99 SAR/mo.
- Pro on Opus with full council is the margin-sensitive tier → the per-tenant **daily token budget** is not optional, it is the margin guard.
- Prompt caching matters: keep system prompts byte-stable within a run (already designed for this); the board/memory grow between runs, not within.

**Levers if costs run hot:** model tier per plan, agents-per-run trimming under budget, brief-length tuning, snapshot reuse (metrics_history already reduces re-derivation), batch-window scheduling.

## Infrastructure sizing

The app is I/O-bound (LLM latency), not CPU-bound:

| Scale | Setup |
|---|---|
| 0–200 stores | 1 web (0.5–1 vCPU) + 1 worker (1 vCPU, 4–6 concurrent jobs) + managed Postgres 2 vCPU. Daily runs spread over a 03:00–07:00 window |
| 200–2,000 | 2 web behind LB + 2–3 workers (queue scales horizontally via SKIP LOCKED) + Postgres 4 vCPU; widen the analysis window per timezone |
| 2,000+ | Add read replica, move webhook_events/usage_ledger partitioning by month, consider queue isolation per job type |

Provider rate limits are the real ceiling — coordinate worker global concurrency with the Anthropic/OpenRouter tier; request limit raises ahead of growth milestones.

## Monitoring (minimum viable)

| Signal | Alert when |
|---|---|
| Job queue depth & oldest queued age | age > 30 min |
| Daily-run failure rate per day | > 5% of tenants |
| Per-tenant token spend vs budget | ≥ 80% (notify), 100% (throttle) |
| Aggregate daily provider spend | > expected × 1.3 |
| Webhook verification failures | spike (secret drift or attack) |
| Salla token refresh failures | any tenant repeated > 3 |
| p95 chat latency | > 60s |
| Subscription state drift (reconciliation job) | any |

Implementation: structured logs (pino) with `store_id` on every line; metrics to a hosted Prometheus/Grafana or a simple admin dashboard reading `usage_ledger`/`jobs` (sufficient pre-1,000 stores).

## Backups & DR

- Managed Postgres with PITR (point-in-time recovery), daily snapshot retained 30 days.
- The DB is the **only** stateful component (playbooks are in the repo; secrets in the secrets manager) — restore = restore DB + redeploy.
- Quarterly restore drill; document RTO target (≤ 4h) and RPO (≤ 15 min with PITR).

## Support model

- *Settings → System check* stays per tenant (now: Salla connectivity + plan/quota state) — first-line self-service.
- Admin impersonation (05) for second line.
- The council itself is third line: a support macro is literally "ask the GM what happened in yesterday's run" via admin.
- Status page (even a static one) once > 100 paying stores.

## Cost & price review cadence

Monthly: usage_ledger → real COGS per plan → adjust plan caps/model tiers before adjusting prices. The achievement ledger gives the value side of the same review (SAR generated per tenant), which is the renewal-pricing argument.
