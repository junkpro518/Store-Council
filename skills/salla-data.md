---
name: salla-data
description: Practical guide to reading Salla Admin API data efficiently — params, pagination, statuses, common pitfalls.
agents: all
---

# Reading Salla Data Efficiently

## Cheap counting
Any list endpoint with `per_page=1` returns `pagination.total` — a full count in one call. Use this for totals instead of paging through everything.

## Useful query params
- `from_date` / `to_date` (YYYY-MM-DD) on orders — always bound your date range.
- `status` on orders — combine with `orders/statuses` to learn this store's custom statuses first.
- `keyword` on products/customers for targeted lookups.
- `per_page` up to 50; prefer `all_pages:true` only when you truly need to aggregate.

## Orders
- `orders` list gives summaries; `orders/{id}` gives line items, shipping, payment method.
- Cancellations/returns appear as statuses — never assume the status taxonomy; read `orders/statuses` once per session.
- COD orders: payment method field; COD has materially higher cancellation risk in GCC.

## Pitfalls
- Amounts may be objects `{amount, currency}` — don't sum strings.
- Timestamps are store-timezone; compare like with like.
- Empty `data` ≠ error; it often means your filter excluded everything — loosen and retry once.
- Large responses get clipped at ~24k chars — narrow with params rather than re-requesting the same payload.
