# Implementation Plan: 001 — GEO, Knowledge, Discussion, Admin

**Spec**: [spec.md](spec.md) · **Stack**: existing TypeScript/Express/JsonStore platform

## Technical context
No new runtime dependencies. All four features compose from existing primitives: `JsonStore`, the provider-neutral `ToolDef` system, the prompt-section builder, and the SPA pattern.

## Structure of the change

| Task | Files |
|---|---|
| T1 GEO agent | `src/agents/definitions.ts` (AGENTS entry), `src/agents/prompts.ts` (CRITICAL_RULES.geo), `skills/geo-playbook.md` |
| T2 Knowledge base | new `src/agents/knowledge.ts`; tool + prompt index in `tools.ts`/`prompts.ts`; routes in `server.ts`; editor in `public/app.js` |
| T3 Discussion | new `src/agents/questions.ts`; `ask_owner` tool; discussion prompt section; daily-brief line in `pipeline/daily.ts`; inbox card in `public/app.js`; `skills/discussion.md` |
| T4 Admin panel | new `src/admin/adminAuth.ts`, `src/admin/platform.ts`; `/admin/*` routes + lock gate in `server.ts`; new `public/admin.html` + `public/admin.js` |
| T5 Process | `.specify/` (done), `.claude/skills/karpathy-guidelines/` (done), this spec folder |
| T6 Verification | unit script covering SC-001..004; typecheck; prod boot |

## Key decisions
- **Knowledge ≠ memory**: memory is what the *agent* learns (auto + curator-managed); knowledge is what the *owner* provides (manual, stable, never curated away). Separate stores, separate tools.
- **Questions answer → memory type `fact`** (it's owner-provided truth), prefixed so the agent knows its provenance.
- **Lock gate** sits inside merchant `requireAuth` (after token verification) so `/auth/*` and static assets keep working when locked — the merchant can log in and see the lock message, not a dead app.
- **Admin panel is English-first** (operator audience), minimal SPA reusing `style.css`.
- **GM exempt from ask_owner cap pressure**: GM may also ask; same cap applies (5 pending/agent).

## Verification plan (per Karpathy guideline #4)
1. Unit script: GEO present/roster count → SC-001. Knowledge CRUD + tool read + prompt index → SC-002. Question → answer → memory → SC-003. Admin/merchant token cross-rejection + lock 402/unlock → SC-004.
2. `tsc --noEmit`, `node --check` both SPAs, prod build boot.
