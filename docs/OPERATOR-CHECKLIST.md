# Operator Checklist — دليل إجراءات المشغّل

> **Living document.** Every procedure YOU (the platform owner) must perform — one-time, before release, after every update, and on a recurring schedule. Each AI/developer session that changes the project MUST update this file (add new procedures, retire obsolete ones, bump the date below).
>
> **Last updated: 2026-06-12** (after SaaS P4+P5 complete — accounts, fleet admin, retention)

---

## 1. One-time setup (do once)

| # | Procedure | How | Status |
|---|---|---|---|
| 1.1 | Run the live OpenRouter check (the only layer untestable from the dev sandbox) | `OPENROUTER_API_KEY=sk-or-... npm run verify:openrouter` on any machine with internet (<$0.05) | ☐ |
| 1.2 | Rotate the OpenRouter key that was shared in chat | openrouter.ai/keys → revoke + create new | ☐ |
| 1.3 | Rename the GitHub repository | GitHub → repo Settings → rename (suggestion: `store-council`) | ☐ |
| 1.4 | Fill placeholders in the privacy page | Edit `public/privacy.html`: company name, CR number, host country, support email/WhatsApp | ☐ |
| 1.5 | Fill placeholders in the listing assets | `docs/listing/app-store-assets.md`: same values + final prices | ☐ |
| 1.6 | Create the Salla Partners app | salla.partners → new app → read-only scopes; record Client ID/Secret + webhook secret | ☐ |

## 2. Deployment (per environment)

| # | Procedure | How |
|---|---|---|
| 2.1 | Provision a host (Node 20+) with HTTPS + stable domain | `docs/DEPLOYMENT.md` (systemd/Caddy/Docker recipes) |
| 2.2 | **Single-store (dedicated) mode** | `npm ci && npm run build && npm start` — no env needed beyond `PORT`/`DATA_DIR` |
| 2.3 | **SaaS (multi-tenant) mode** | Postgres up (`docker compose up -d postgres` or managed) → `DATABASE_URL=... npm run migrate` → web: `STORAGE=postgres DATABASE_URL=... SALLA_WEBHOOK_SECRET=... npm start` → worker: same env + `npm run worker` (both processes required) |
| 2.4 | First-run: set owner password; admin password at `/admin.html` | Browser |
| 2.5 | Partners portal wiring | Webhook URL `https://<domain>/webhooks/salla` (Signature strategy), callback `https://<domain>/auth/salla/callback`, App URL = embed link from Settings |
| 2.6 | Migrating an existing single-store customer into SaaS | `DATABASE_URL=... npx tsx scripts/import-json-data.ts --data <their DATA_DIR> [--store <uuid>]` (notifies live servers automatically) |

## 3. The Salla dress rehearsal (before App Store submission)

Run on a **demo store** with the draft app — the only checks no sandbox can perform:

| # | Check | Pass looks like |
|---|---|---|
| 3.1 | Install the draft app on the demo store | `app.store.authorize` arrives; dashboard shows **Connected via Salla App Store**; in SaaS mode a trial tenant auto-appears |
| 3.2 | Open the App URL inside the Salla merchant panel | Dashboard renders in Salla's iframe, auto-logged-in, fully functional |
| 3.3 | *Settings → System check* | AI ✓, Salla ✓ (store name shown), webhook secret ✓ |
| 3.4 | Run a real first analysis | Report with sensible Arabic findings citing the demo store's actual data; actions extracted |
| 3.5 | Chat with two managers (one @mention) | Live answers grounded in store data; @routing switches manager |
| 3.6 | Trigger a store event (place a test order) | Appears in the dashboard event feed within seconds |
| 3.7 | Uninstall the app | Store disconnects immediately; (SaaS) tenant marked uninstalled, MCP token dead |
| 3.8 | Reinstall within minutes | Connection restored **with all prior memory/reports intact** |

## 4. After every code update (the regression gate)

Run before deploying any change — all must pass:

```bash
npm ci && npm run typecheck
node --check public/app.js && node --check public/admin.js
npx tsx tests/e2e-mock-openrouter.ts                 # agent stack (json mode)
npm run build && node dist/server.js                  # boots; Ctrl+C exits cleanly
# SaaS mode additionally (needs a migrated dev Postgres):
DATABASE_URL=... npx tsx tests/pg-parity.ts           # storage parity
DATABASE_URL=... npx tsx tests/tenant-isolation.ts    # SC-1: tenants never cross
DATABASE_URL=... npx tsx tests/job-queue.ts           # SC-4: scheduling/worker
DATABASE_URL=... npx tsx tests/billing-lifecycle.ts   # SC-3/SC-6: subscriptions, quotas, metering
DATABASE_URL=... npx tsx tests/accounts-fleet.ts      # login-with-Salla, fleet admin, retention
```

Then: deploy → open the dashboard → *System check* green → send one chat message.

## 5. Recurring operations

| Cadence | Procedure |
|---|---|
| **Daily (first 2 weeks of any launch)** | Open the dashboard after the scheduled run: report present? quality acceptable? `[worker]`/`[scheduler]` logs clean? |
| **Weekly** | Check failed jobs: `select * from jobs where state='failed'` (SaaS) or server logs (dedicated). Review pending owner-questions & change-requests aren't piling up. |
| **Weekly** | Verify backups ran: dedicated = `DATA_DIR` copy exists; SaaS = Postgres PITR/snapshot healthy. |
| **Monthly** | Token spend vs. plan prices (OpenRouter dashboard / usage ledger once P4 lands). Adjust plan caps before prices. |
| **Monthly** | Re-run the question battery from the GEO playbook on your own listing («أفضل تطبيق تحليل لمتجر سلة؟») — your product should also be the AI's answer. |
| **Quarterly** | Competitive review per `docs/STRATEGY.md`; restore-from-backup drill; rotate admin password + integration tokens of any departed staff. |
| **On any suspicion of leak** | Rotate: embed link (Settings), integration token (Settings), webhook secret (Partners portal + Settings), OpenRouter key. Each rotation is one click + paste. |

## 6. Incident quick reference

| Symptom | First moves |
|---|---|
| No daily report | Dedicated: server logs `[scheduler]`. SaaS: worker running? `select * from jobs order by id desc limit 10` — `queued` past due ⇒ worker down; `failed` ⇒ read `payload->>'last_error'` |
| Dashboard 402 for merchant | Tenant locked in central panel — intentional? `/admin.html` → unlock |
| Webhooks rejected (401) | Secret mismatch: Partners portal secret vs `SALLA_WEBHOOK_SECRET`/Settings |
| Agents error mid-chat | *System check* → AI badge red ⇒ key/credit issue at OpenRouter; model deprecated ⇒ change model id in Settings |
| Postgres down (SaaS) | Web keeps serving cached reads but writes queue in memory — restore DB promptly, then restart processes; check `jobs` for missed runs (enqueuer self-heals same-day) |

## 7. Pending procedures (added as phases land — keep in sync with specs/004 tasks.md)

- ☐ **P4 billing (now live):** at listing time, confirm the subscription event names Salla actually sends for your app configuration (handlers tolerate suffix variants and log unknowns — check the webhook log after configuring plans); walk subscribe → expire → reactivate on a test store; spot-audit `usage_ledger` token sums vs the OpenRouter dashboard monthly.
- ☐ **Accounts (now live):** at dress-rehearsal, click "تسجيل الدخول عبر سلة" with a real merchant account and confirm it lands in the right tenant (the /user/info field mapping is the one thing mocked in tests). SaaS env now also requires `SALLA_CLIENT_ID`/`SALLA_CLIENT_SECRET`.
- ☐ **Fleet ops (now live):** daily glance = central panel Fleet monitoring card (queue, failures, tenants by status, tokens). Use impersonation ("support") instead of asking merchants for screenshots — every use is audit-logged; review `select * from audit_log order by id desc limit 50` monthly. Purge is permanent — only for uninstalled tenants past retention or written deletion requests.
- ☐ **Launch checklist** (`docs/saas/08-rollout.md`) before SaaS GA.
