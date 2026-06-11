# Store Council Constitution

The enduring principles for the Store Council platform. Specs, plans, and code must comply; `/speckit-analyze` and `/speckit-checklist` check against these. Amendments require updating this file in the same change.

## Core Principles

### I. Read-Only by Default; Writes are Owner-Gated and Non-Destructive
The platform observes and advises. Store reads use a GET-only allowlist; store writes exist only behind the owner's explicit write mode (`read_only` default, `confirm`, or `auto`), go through a separate allowlist that contains **no DELETE**, are journaled, and are never performed silently. An agent must never claim to have changed the store unless a write actually succeeded.

### II. OpenRouter is the Sole LLM Provider
Every LLM transaction routes through OpenRouter. No direct provider SDKs. `settings.provider` is coerced to `"openrouter"`. This keeps billing and model choice in one place.

### III. Single Storage Abstraction
All persistent state goes through `JsonStore` (atomic, synchronous `update`). No ad-hoc files, no hidden globals. This is what makes the future Postgres/multi-tenant swap a single seam (`docs/saas/`).

### IV. Strict Tenancy & Panel Separation
Merchant auth and central (platform-owner) auth are independent and non-interchangeable. A locked tenant is suspended (402) on merchant routes but can still authenticate to see the lock state. The General Manager is always enabled and always read-only.

### V. Provider-Neutral, Real, Tangible Features
Tools are defined once and consumed by one agent loop. Every shipped feature is fully wired and working end to end — no placeholder UI, dead endpoints, or stubbed logic presented as complete. "Done" means verified.

### VI. Arabic-First, Merchant-Empowering
The merchant controls every aspect from the dashboard (ideally embedded inside Salla) without touching code. UX is Arabic-first with English support. Advice is concrete, numeric, and grounded in the store's own data, with step-by-step dashboard instructions.

## Engineering Workflow

Spec-first via Spec Kit is mandatory for non-trivial changes: constitution → specify → clarify → plan → tasks → checklist → analyze → implement. The Karpathy coding guidelines in `CLAUDE.md` (think before coding, simplicity, surgical changes, goal-driven verification) govern implementation. Verification is manual and required: `typecheck`, `build`, `node --check` on SPAs, and a runtime smoke test before claiming completion.

## Governance

This constitution supersedes ad-hoc preferences. Any change that conflicts with a principle must either comply or amend the principle here in the same change, with the rationale recorded in the feature's `plan.md`. The invariants here are mirrored in `CLAUDE.md` §2 — keep both in sync.

**Version**: 1.0.0 | **Ratified**: 2026-06-11 | **Last Amended**: 2026-06-11
