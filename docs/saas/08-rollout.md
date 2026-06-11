# 08 — Rollout Plan & Risk Register

## Phases

### Pilot (weeks 1–2 after P2 lands) — 5–10 friendly stores
- Hand-picked merchants (mix of sizes/verticals), free Pro in exchange for feedback + permission to measure.
- Goals: validate token-cost model per store (07), report quality across very different catalogs, first-report conversion moment, Arabic UX issues.
- Exit criteria: COGS within model ±30%; ≥7 of 10 pilots open the report ≥4 days/week; zero cross-tenant incidents.

### Closed beta (weeks 3–6) — ~50 stores
- Salla App Store listing in draft/unlisted; invite via community/waitlist.
- Billing live (real subscriptions, discounted founding-merchant price locked for 12 months — creates advocates and reference logos).
- Goals: webhook/billing lifecycle hardening at volume, job-queue behavior with concurrent runs, support load measurement.
- Exit criteria: subscription webhooks reconcile cleanly for 2 consecutive weeks; daily-run failure rate < 2%; support < 0.5 tickets/store/month.

### GA (week 7+)
- Public App Store listing (the eligibility work — webhooks, Easy Mode, read-only scopes — is already done in the codebase).
- Marketing per docs/STRATEGY.md: lead with the daily report + achievement ledger; comparison section vs. generic AI-chat integrations; free first report.
- Quarterly competitive review (strategy doc) drives the roadmap re-prioritization.

## Migrating existing single-store customers (if any sold before SaaS)

1. Their deployment's `DATA_DIR` is the export: run `scripts/import-json-data.ts` (06, Step 1) against production to create their tenant with full history — reports, memory, ledger, metrics all preserved (the continuity is the pitch: "your council remembers everything").
2. Offer: founding price ≤ their amortized one-time cost; or they keep self-hosting (the dedicated tier) — the codebase keeps supporting that mode by design.
3. Sunset self-managed support after 6 months except for dedicated-tier contracts.

## Launch checklist (condensed)

- [ ] Migrations applied; RLS enabled; restore drill performed
- [ ] Platform secrets in secrets manager; no AI keys in any tenant row (grep + test)
- [ ] Tenant-isolation test green (two stores, zero cross-reads)
- [ ] Salla plans configured; all `app.subscription.*` events observed end-to-end on a test store (start, renew, cancel, expire, reinstall)
- [ ] Trial → paid → past_due → locked → reactivate walked manually
- [ ] Token budgets + throttling verified with a stub-provider load test
- [ ] Monitoring alerts firing in staging; on-call rotation (even if it's one person) written down
- [ ] Privacy policy + data-retention page (90-day rule) published in Arabic + English; PDPL review
- [ ] App Store assets: Arabic-first screenshots (report, ledger, chat), demo video, support contact

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Token costs exceed model at real catalog sizes | Medium | Margin erosion | Pilot measures first; per-tenant budgets + model-tier levers (07); reprice caps before prices |
| Salla review rejects or delays listing | Medium | Launch slip | Read-only scopes + signature webhooks already conform; submit early in beta with support contact ready |
| Salla restricts third-party API in favor of native AI | Low-Med | Existential pressure | STRATEGY.md Pillar C (MCP-backend option), Zid adapter on roadmap, dedicated tier independent of marketplace |
| Cross-tenant data leak bug | Low | Severe (trust) | TenantStore contract + RLS + isolation tests in CI + audit log; incident plan written before GA |
| Provider outage during the analysis window | Medium | Missed daily reports | Queue retries with backoff into a later window; provider fallback (Anthropic↔OpenRouter) as a platform-level toggle; status banner |
| One store's hostile data (prompt injection in reviews) produces embarrassing output | Medium | Reputation | Read-only architecture bounds damage; output stays in that tenant's dashboard; keep the "advice, owner executes" framing |
| Renewal churn after novelty fades | Medium | LTV | The accountability loop is the counter: achievement ledger at renewal, impact measurements, weekly digests (roadmap P1) |
| Support load in Arabic exceeds capacity | Medium | CSAT | Self-service System check, owner guide, GM-as-support-tool; founding cohort kept small until ticket rate known |

## KPIs to watch from day one

- Trial → paid conversion (target ≥ 25% after the first report lands)
- D30 / D90 logo retention (target ≥ 90% / ≥ 80%)
- Actions marked done per store per month (the leading indicator of perceived value)
- Measured-impact positives ratio in the ledger (the renewal weapon)
- COGS per store vs plan price (gross margin ≥ 70% blended)
