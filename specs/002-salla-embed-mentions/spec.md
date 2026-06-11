# Feature Specification: Salla Dashboard Embedding + @Mention Chat Routing

**Branch**: `claude/sweet-clarke-w79ood` · **Created**: 2026-06-11 · **Status**: Implemented

## US1 — Merchant panel embedded inside the Salla dashboard (P1)
As a merchant, I open Store Council as a page **inside my Salla dashboard** (Salla apps can expose an external app URL rendered in the merchant panel) instead of a separate site, without logging in again each time.

**Mechanism** (works with any "app URL" Salla renders in an iframe):
1. The dashboard becomes frame-embeddable **only by Salla domains** (`Content-Security-Policy: frame-ancestors` allowing `*.salla.sa` / `*.salla.group`; the central panel `/admin*` stays `DENY`).
2. A signed **embed link** (`/embed?k=<secret>`) is generated from Settings; the merchant pastes it as the app URL in the Salla Partners portal. Opening it mints a session automatically (no password inside the iframe) and redirects to the dashboard. The key is rotatable; rotation severs old embeds.
3. Embedded mode is detected (iframe) and the UI stays fully functional.

**Acceptance**: `/` served with Salla frame-ancestors and no X-Frame-Options; `/admin.html` still DENY; `/embed` with a valid key returns a page that stores a session and redirects, with an invalid key returns 401; embed link visible + rotatable in Settings; rotation invalidates the old key.

## US2 — @mention routing in chat (P1)
As a merchant, typing `@` in the chat box suggests managers (by id, English or Arabic name); sending `@pricing سؤالي…` routes the question to that manager — switching the conversation view there — regardless of which manager is currently open.

**Acceptance**: mention parsed from the start of the message (id / display-name / Arabic-name prefix, case-insensitive); suggestion popup appears while typing `@`; message (mention stripped) is delivered to the mentioned manager's chat and the view switches to it; non-matching mentions send unchanged to the current manager; disabled managers are not suggested.

## US3 — Karpathy CLAUDE.md in core files (P2)
The `CLAUDE.md` from andrej-karpathy-skills is merged into the project root `CLAUDE.md` (with project context header, Spec Kit managed block preserved, MIT attribution).

**Acceptance**: root CLAUDE.md contains the four principles + project context + SPECKIT block.

## Success criteria
- **SC-001**: header matrix verified by HTTP test (/, /admin.html, /embed).
- **SC-002**: invalid embed key 401; valid key → token works against a protected API; rotation invalidates.
- **SC-003**: mention parser unit-verified for: `@pricing`, `@GEO Manager`, Arabic name, no-mention, unknown mention, disabled agent.
