<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->

# CLAUDE.md — Store Council (مجلس المتجر)

> This file is the contract for every tool, agent, and contributor that modifies this repository. Read it fully before changing anything. It is authoritative; when in doubt, it wins over assumptions.

## 1. What this project is

**Store Council** is a multi-agent AI advisory platform for **Salla** e-commerce merchants. It connects to one store in strict **read-only** mode by default, analyzes the whole store automatically every day, and gives the merchant prioritized recommendations with step-by-step Salla-dashboard instructions. The merchant chats with **16 AI "department managers"** (a General Manager orchestrator + 15 specialists), each an expert in its field. Managers learn over time, discuss, ask the owner questions, and (optionally) can edit the store under owner-controlled permissions.

- **Stack:** TypeScript (ES modules, NodeNext), Express, vanilla-JS SPAs (no framework). Node 20+.
- **LLM provider:** **OpenRouter only.** All LLM transactions route through OpenRouter (`src/llm/client.ts`, OpenAI-compatible). There is no Anthropic/other-provider path — do not reintroduce one without an explicit instruction.
- **Persistence:** file-backed JSON via `src/store/jsonStore.ts` (single abstraction; atomic writes). Swappable for Postgres for the SaaS conversion (see `docs/saas/`).
- **Two web surfaces:** merchant dashboard (`public/index.html` + `app.js`) and central/platform-owner panel (`public/admin.html` + `admin.js`). The merchant panel is embeddable inside the Salla dashboard.
- **Market:** Arabic-first (KSA/GCC), English supported.

For deeper detail read `README.md` and `docs/ARCHITECTURE.md`. For the HTTP surface read `docs/API.md`. Do not duplicate those here — keep this file about *how to work on the repo*.

## 2. Non-negotiable invariants

Breaking any of these is a regression even if tests pass:

1. **Read-only by default.** The Salla client (`src/salla/client.ts`) only issues `GET` against an allowlist for reads; writes go through `sallaWrite` against a separate, no-DELETE allowlist and are gated by the owner's write mode (`read_only` | `confirm` | `auto`). Never add a destructive (DELETE) capability. Never let an agent claim it changed the store when it didn't.
2. **OpenRouter is the only LLM provider.** `settings.provider` is coerced to `"openrouter"` on read and write. Don't add direct provider SDKs.
3. **Tenant lock + auth separation.** Merchant auth (`src/auth/owner.ts`) and central-panel auth (`src/admin/adminAuth.ts`) are independent; tokens are not interchangeable. A `locked` tenant returns 402 on merchant routes. The General Manager (`gm`) is always `enabled` and always `read_only`.
4. **All state flows through `JsonStore`.** No ad-hoc file or global state. `update()` must stay synchronous (its atomicity depends on it).
5. **Agents are provider-neutral.** Tools are defined once as `ToolDef` (`src/agents/tools.ts`) and consumed by the single OpenRouter agent loop (`src/agents/runner.ts`). Don't fork tool definitions per provider.
6. **Real, working features only.** No placeholder UI, dead endpoints, or stubbed logic presented as done. Every UI control must call a real, working endpoint; every endpoint must be reachable. Verify before claiming completion.

## 3. MANDATORY workflow — Spec Kit for every change

This repo is managed with **Spec Kit** (`.specify/`, `specs/`). **Any non-trivial modification (new feature, behavior change, refactor that touches more than one module) MUST go through the full Spec Kit flow.** Use every relevant feature, in order:

1. **`/speckit-constitution`** — read (and, if the change affects principles, update) the project constitution at `.specify/memory/constitution.md`. The invariants in §2 above are constitutional; keep them in sync.
2. **`/speckit-specify`** — write/extend the feature spec under `specs/NNN-slug/spec.md`: user stories + acceptance criteria + measurable success criteria. No implementation detail here.
3. **`/speckit-clarify`** — resolve every ambiguity with targeted questions and record answers in the spec **before** planning. Do not silently pick an interpretation (see §4.1).
4. **`/speckit-plan`** — produce `plan.md`: technical approach, the exact files to touch, decisions and trade-offs, and a verification plan mapped to the success criteria.
5. **`/speckit-tasks`** — generate `tasks.md`: dependency-ordered, each task tied to a success criterion.
6. **`/speckit-checklist`** — generate a quality checklist validating the spec is complete, clear, consistent.
7. **`/speckit-analyze`** — run the cross-artifact consistency check across spec/plan/tasks before implementing; fix drift.
8. **`/speckit-implement`** — execute the tasks. Keep the repo building and tests passing at each step.

Trivial changes (a typo, a string, a one-line fix) may skip the ceremony — use judgment, but bias toward the flow. When you finish, the `specs/NNN-slug/` folder (spec + plan + tasks, checked boxes) is the durable record; commit it with the code.

## 4. Coding guidelines (Karpathy)

Behavioral guidelines to reduce common LLM coding mistakes. **Tradeoff:** these bias toward caution over speed. For trivial tasks, use judgment.

### 4.1 Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 4.2 Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked. No abstractions for single-use code.
- No "flexibility"/"configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it. Ask: "Would a senior engineer say this is overcomplicated?"

### 4.3 Surgical Changes
**Touch only what you must. Clean up only your own mess.**
- Don't "improve" adjacent code, comments, or formatting. Don't refactor what isn't broken. Match existing style.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that *your* changes made unused; don't remove pre-existing dead code unless asked.
- The test: every changed line traces directly to the request.

### 4.4 Goal-Driven Execution
**Define success criteria. Loop until verified.**
- "Add validation" → "write tests for invalid inputs, then make them pass."
- "Fix the bug" → "write a test that reproduces it, then make it pass."
- State a brief verifiable plan for multi-step work. Weak criteria ("make it work") require constant clarification; strong ones let you loop independently.

**These guidelines are working if:** fewer unnecessary diffs, fewer rewrites from overcomplication, and clarifying questions come before mistakes.

## 5. Project conventions

- **Modules:** `src/agents/` (definitions, prompts, tools, runner, memory, board, knowledge, questions, skills-loader), `src/pipeline/` (daily, impact, curator, metrics), `src/salla/` (auth, client, webhooks, storeInfo), `src/admin/` (adminAuth, platform), `src/changes/`, `src/settings/`, `src/auth/`, `src/llm/`, `src/mcp/`, `src/store/`. Playbooks are markdown in `skills/`.
- **Adding an agent:** entry in `src/agents/definitions.ts` (endpoints scoped to its domain), critical rules in `prompts.ts`, optionally a `skills/*.md` playbook with `agents:` frontmatter. The roster count and any "N specialists" copy must be updated together.
- **Adding a tool:** define a `ToolDef` in `src/agents/tools.ts` (provider-neutral JSON-schema params + async `run`); it's automatically offered to the agent loop and (if relevant) the MCP server.
- **Adding state:** a new `JsonStore<T>(name, fallback)`; never write files directly. For owner-facing data add REST routes in `src/server.ts` guarded by `requireAuth` (merchant) or `requireAdmin` (platform owner).
- **i18n:** dashboard strings live in the `STRINGS` map in `public/app.js` with `ar`/`en` keys; add both. Arabic is primary.
- **Security:** secrets only in `DATA_DIR` JSON (single-tenant) — never log them; verify webhook HMAC; keep `requireAuth`/`requireAdmin` on every non-public route; preserve the CSP frame policy (merchant embeddable by `*.salla.sa` only, admin never).

## 6. Verify before you claim done

There is no automated CI yet, so verification is manual and mandatory:

```
npm run typecheck        # tsc --noEmit — must be clean
npm run build            # tsc — must succeed
node --check public/app.js && node --check public/admin.js
npx tsx tests/e2e-mock-openrouter.ts      # agent stack against the LLM mock
# When STORAGE=postgres paths are touched (needs a migrated dev Postgres):
#   npx tsx tests/pg-parity.ts && npx tsx tests/tenant-isolation.ts && npx tsx tests/job-queue.ts
```

Then a runtime smoke test against a throwaway `DATA_DIR`: boot `node dist/server.js`, exercise the changed endpoints with `curl`, and confirm real behavior (not just 200s). For agent/LLM-dependent paths that need a live OpenRouter key, state explicitly that they were verified structurally but need a keyed run — never imply you tested a live LLM call you couldn't make. Delete test `data/` before committing.

**Keep the living docs in sync — part of "done" for every change:**
- `docs/OPERATOR-CHECKLIST.md` — the platform owner's procedures. Add/retire procedures your change implies and bump its "Last updated" date.
- `docs/VERIFICATION.md` — append what you verified and how.
- `docs/API.md` — any route you add/change.
- `specs/004-saas-conversion/tasks.md` — check off completed tasks (with amendment notes when scope shifts).

Commit messages: describe what changed and why; end with the session link line the harness expects. Develop on the designated branch; never push to a different branch without explicit permission.

---
*Sections 4 adapted from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT).*
