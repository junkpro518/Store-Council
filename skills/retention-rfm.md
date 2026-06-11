---
name: retention-rfm
description: Retention playbook — RFM segmentation from order data, win-back sequencing, loyalty mechanics.
agents: retention, marketing, customer-service
---

# Retention & RFM Playbook

## Build RFM from orders alone
For each customer: **R**ecency (days since last order), **F**requency (order count), **M**onetary (total spend). Practical segments:
- **Champions** — R<30d, F≥3: protect; early access, never discount-spam them.
- **Loyal** — F≥3, R 30–90d: cross-sell from their category history.
- **At-risk** — F≥2, R 90–180d: win-back NOW; this is the highest-ROI segment.
- **Hibernating** — R>180d: one strong offer, then stop; don't pollute metrics chasing them.
- **One-timers** (usually 60–80% of customers): the second purchase is the whole game — post-purchase flow at day 7–14 with a category-matched suggestion.

## Win-back sequencing
1. Day 0: "we miss you" + what's new in their category (no discount).
2. Day 7: small personal coupon (use customer groups in Salla for targeting).
3. Day 21: final, stronger offer with expiry. Then silence.

## Metrics to keep honest
- Repeat-purchase rate = customers with ≥2 orders ÷ all customers (benchmark 20–30% for healthy stores).
- Track it monthly via metrics_history deltas; a falling rate while acquisition grows means leaky-bucket growth — say so loudly.
