---
name: inventory-health
description: Inventory health playbook — stockout cost, dead stock liquidation, reorder math from sales velocity.
agents: inventory, finance, catalog
---

# Inventory Health Playbook

## The two losses
1. **Stockouts on movers** — lost revenue ≈ daily sales velocity × days out × price. Compute and state it; it turns "restock X" into "you're losing ~1,200 SAR/week".
2. **Dead stock** — capital + attention frozen. Dead = no sales in 60–90 days (category-dependent). Liquidation ladder: bundle with movers → targeted coupon → storewide sale section → write off.

## Reorder math (no ERP needed)
- Velocity = units sold ÷ days in window (use 30d, sanity-check vs 90d for seasonality).
- Reorder point = velocity × (supplier lead time + safety days). Ask the owner for lead times once, then save_memory them.
- Flag any product whose stock ÷ velocity < lead time — that's a stockout already scheduled.

## Assortment signals
- Top 20% of products usually drive ~80% of revenue — name the actual top sellers and check their stock FIRST every day.
- A product with rising sales velocity 3 weeks running is a candidate for deeper stock + better placement (tell Catalog).
- Before seasonal peaks (see ksa-calendar), shift the whole analysis 4–6 weeks forward.
