# Feature Specification: GEO Agent, Knowledge Bases, Discussion Intelligence, Central Admin Panel

**Branch**: `claude/sweet-clarke-w79ood` · **Created**: 2026-06-11 · **Status**: Implemented

## User Scenarios

### US1 — GEO manager (Priority: P1)
As a store owner, I have a 15th specialist, **GEO (Generative Engine Optimization) Manager**, who optimizes my store's content to be cited and recommended by AI assistants (ChatGPT, Claude, Perplexity, Google AI Overviews) — the channel where my shoppers increasingly ask "what should I buy".

**Acceptance**: GEO appears in the council roster, runs in daily analysis, is chattable, has its own playbook, endpoints, and critical rules; all existing customization (rename, disable, write mode, memory) applies.

### US2 — Per-agent knowledge base (Priority: P1)
As a store owner, I can attach **knowledge documents** to any manager (supplier price lists, brand guidelines, return policy details, ad-account exports) — information that is *not* in Salla. Managers consult these documents while analyzing and chatting.

**Acceptance**: CRUD per manager from the dashboard; documents listed in the agent's prompt by title; agent loads content on demand via a tool; capped (30 docs/agent, 20k chars/doc); a shared "all managers" bucket exists at the API level.

### US3 — Discussion intelligence (Priority: P1)
Managers behave like colleagues in a discussion, not suggestion machines: they state assumptions, present options with trade-offs and a recommendation, push back, and **ask the owner questions** when a decision or missing fact blocks better advice. Questions asked during autonomous work queue in a dashboard inbox; the owner's answers become the manager's memory.

**Acceptance**: `ask_owner` tool (capped pending per agent); "Questions from your managers" dashboard card with answer/dismiss; answers written to agent memory; prompts updated with discussion principles (adapted from Karpathy guidelines: surface assumptions, don't pick interpretations silently, present trade-offs); daily brief instructs asking instead of guessing.

### US4 — Central (platform-owner) panel separated from merchant panel (Priority: P1)
The **platform owner** (who sells the product) gets a separate central control panel at `/admin.html` with its own credentials, managing: the store/tenant (plan, lock/unlock, notes), agent fleet status, usage counters, curator, and pending operational state. Locking a tenant blocks the merchant dashboard until unlocked (e.g. unpaid subscription).

**Acceptance**: separate admin auth (setup/login/sessions, lockout); merchant tokens cannot call `/admin/*` and vice versa; plan + status persisted; locked status returns 402 on merchant APIs with a clear message; overview shows store identity, counts (reports, actions done, memories, pending changes/questions), curator state.

### US5 — Engineering process (Priority: P2)
Spec Kit is installed in the repo (`.specify/`, `/speckit-*` commands) and this feature batch is developed spec-first. The Karpathy guidelines skill is installed at `.claude/skills/karpathy-guidelines/` to govern future coding sessions, and its principles are adapted into a council playbook.

## Requirements

- **FR-001**: GEO agent definition with AI-search-domain endpoints (products, categories, seo, store-pages, brands, reviews, questions) and critical rules.
- **FR-002**: `skills/geo-playbook.md` — GEO field guide (citability, entity clarity, schema/FAQ coverage, AI-answer testing loop).
- **FR-003**: Knowledge store keyed by agent id + `"all"`; tool `knowledge_base` (list/read); prompt index block; REST CRUD; dashboard editor per manager.
- **FR-004**: Question queue store; tool `ask_owner`; REST (list/answer/dismiss); dashboard inbox; answer → memory (`fact`) for the asking agent.
- **FR-005**: Discussion section in every system prompt + updated daily brief.
- **FR-006**: Admin auth module (scrypt + sessions + lockout, independent of merchant auth); platform state {plan, status, notes}; `/admin/*` API; `admin.html` SPA; merchant-route lock gate.
- **FR-007**: `skills/discussion.md` shared playbook adapted from Karpathy guidelines (attributed).
- **FR-008**: Docs updated (README, API, ARCHITECTURE); all existing tests still pass.

## Success Criteria

- **SC-001**: 16 agents listed (GM + 15 specialists incl. GEO); GEO daily findings present in reports.
- **SC-002**: A knowledge doc added via UI is visible to its agent (prompt index + tool read) — verified by unit test.
- **SC-003**: A pending question answered via the dashboard appears in the agent's memory — verified by unit test.
- **SC-004**: Admin and merchant credentials are non-interchangeable (verified); locking blocks merchant API with 402 and unlocking restores it.
