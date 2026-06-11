# Release Review & Hardening — Findings & Resolutions

Three sub-agents audited the project (security/Opus, logic/Opus, structure/Sonnet).

## Fixed
- Webhook signature now compares raw MAC bytes, accepts hex AND base64 (sec #1).
- Webhook REPLAY protection: 5-min delivery fingerprint cache (sec #2). Verified.
- Webhook MERCHANT BINDING: authorize/uninstall for a different merchant than the
  bound store is refused — blocks token injection (sec #3). Verified.
- MCP-invoked agents are forced read_only via runAgent({forceReadOnly}); an
  integration token can no longer drive store writes (sec #4/#5). Verified.
- `app.set('trust proxy', 1)` so login lockout keys on the real client IP (sec #7).
- OAuth `state` set replaced with a TTL Map (10 min), no unbounded growth (sec #8).
- Anthropic loop empty/iteration-exhausted reply guard — never persists a blank
  assistant turn (logic #1/#2).
- @mention bare "@manager" with no text is a no-op, not a literal send (logic #8).

## Assessed as NOT a defect (with reasoning)
- logic #3 (`output_config.format` "invalid"): it is the CURRENT canonical Anthropic
  structured-output param. Moot now — Anthropic path removed; OpenRouter uses
  `response_format.json_schema`.
- logic #6 (`JsonStore.update` lost-update race): `update()` is fully synchronous
  (readFileSync→fn→writeFileSync, no await), so it is atomic in single-threaded
  Node. False positive for this implementation; invariant documented in CLAUDE.md.
- Salla error text to clients: only reaches the authenticated owner + agents that
  need it for recovery — not an untrusted leak. Left per simplicity principle.

## Also in this batch (user instructions)
- Platform routes ALL LLM transactions through OpenRouter; Anthropic SDK removed,
  provider coerced to "openrouter" on read+write, UI is OpenRouter-only.
- Project renamed to "store-council" (package.json). GitHub repo slug rename
  must be done in GitHub Settings (no API tool available).
- CLAUDE.md rewritten as the authoritative contract with a MANDATORY Spec Kit
  workflow; constitution filled at .specify/memory/constitution.md.
- Central panel now shows the Salla App URL so the operator wires the in-Salla
  embed without the merchant ever using the external site.
