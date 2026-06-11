# 01 — Vision & Scope

## Vision

Give every Salla merchant the equivalent of a full executive team — a council of AI department managers who study the store every day, talk to each other like real colleagues, and hand the owner a clear, prioritized action plan with exact implementation steps.

## Problem

Most small/medium Salla merchants:

- Cannot afford specialists in pricing, SEO, marketing, CRO, logistics, customer service, etc.
- Don't know *what* to improve first, or *how* to do it inside the Salla dashboard.
- Get generic advice from articles/tools that isn't grounded in their actual store data.

## Solution

A SaaS app published on the **Salla App Store** that:

1. Connects to the merchant's store via OAuth with **read-only** permissions.
2. Syncs store data daily (products, orders, customers, marketing, reviews, shipping, etc.).
3. Runs a council of **14 specialist agents** plus an **Orchestrator** that coordinates them.
4. Produces a **daily report**: prioritized recommendations, each with evidence from the store's own data and a step-by-step Salla-dashboard implementation guide.
5. Lets the owner **chat directly with any agent** ("Ask the Pricing Manager why she suggested raising the price of product X").

## Goals

- **G1** — Cover *every* operational aspect of an e-commerce store (see agent roster in doc 03).
- **G2** — Fully automatic daily operation with zero merchant effort.
- **G3** — Every recommendation must cite store data as evidence and include implementation steps a non-technical merchant can follow.
- **G4** — Arabic-first UX (Salla's market is primarily Saudi Arabia / GCC), with English support.
- **G5** — Strict read-only access; the platform can never change anything in the store.

## Non-Goals (explicitly out of scope)

- ❌ Writing to the store (creating products, changing prices, sending campaigns). All write actions remain manual, performed by the merchant.
- ❌ Acting as a customer-facing chatbot on the storefront.
- ❌ Supporting platforms other than Salla in v1 (architecture keeps a provider abstraction for future Zid/Shopify support).
- ❌ Financial/legal advice with regulatory liability — agents give operational guidance with disclaimers.

## Target Users

| Persona | Need |
|---|---|
| Solo merchant (1 person) | "Tell me the 3 most important things to do today and how." |
| Small team (2–10) | Departmental advice each team member can act on. |
| Agency managing stores | Multi-store dashboard (Phase 3). |

## Success Metrics

- ≥ 60% of merchants open the daily report ≥ 4 days/week.
- ≥ 30% of recommendations marked "Implemented" by merchants.
- Measurable uplift on tracked KPIs (conversion proxy, AOV, repeat-purchase rate) for stores that implement ≥ 50% of recommendations.
- Chat CSAT ≥ 4.5/5.

## Key Constraints

- Salla API rate limits → incremental sync + webhook-driven updates (doc 04).
- LLM cost per store per day must stay within subscription margin → tiered analysis depth (doc 06).
- Read-only scope must be enforced at *three* layers: OAuth scopes, API client allowlist, and agent tool definitions (doc 10).
