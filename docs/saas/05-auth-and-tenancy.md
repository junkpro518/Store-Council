# 05 — Accounts, Identity & Per-Tenant Security

## Merchant identity: login with Salla

Replace the single owner password with merchant accounts:

- **Primary: "Sign in with Salla"** — the app already has OAuth credentials; the same flow that authorizes store access identifies the merchant user. On `app.store.authorize` (install) we create the tenant; on first dashboard visit the merchant signs in with Salla and we link `salla_user_id` → account → store (`account_stores`).
- **Fallback: email + password** (scrypt — reuse today's hashing code) for staff users and for resilience if Salla OAuth is unavailable.
- Sessions: same bearer-token mechanism as today, but rows in `sessions` keyed to `account_id` (multi-device, revocable).

## Authorization model

| Role (per store) | Can |
|---|---|
| `owner` | Everything: settings, agents config, memory management, billing page, MCP token, staff invites |
| `staff` | Dashboard read, reports, chat with managers, mark actions done/dismissed |

- Middleware resolves `account → store → role` for every request; the store id in the URL/session must match an `account_stores` row, otherwise 404 (don't leak existence).
- All existing 🔒 endpoints keep working — `requireAuth` becomes `requireTenant(role)`.

## Secrets handling (changes from single-store)

| Secret | Today | SaaS |
|---|---|---|
| Anthropic/OpenRouter keys | Tenant settings (plaintext JSON on customer's disk) | **Platform env/secrets manager only.** Never in tenant rows. BYOK tier: tenant key encrypted with AES-256-GCM under a platform KMS key, decrypted in-memory per job |
| Salla app client id/secret + webhook secret | Tenant settings | Platform config (it's one Salla *app* serving all tenants) |
| Salla access/refresh tokens | Plaintext JSON file | `salla_tokens` encrypted at rest (same AES-GCM envelope), since one DB now holds thousands of stores' tokens |
| Integration (MCP) tokens | One global | Per-tenant rows, hashed at rest (compare by hash), shown once on creation + rotate |
| Owner password hash | scrypt (keep) | scrypt (keep) |

Key management: a single `PLATFORM_ENCRYPTION_KEY` (32 bytes) from the secrets manager at boot; envelope format `v1:iv:ciphertext:tag`. Rotation procedure: add `v2` key, re-encrypt lazily on read, background sweep.

## Per-tenant security boundaries

1. **Data:** every query scoped by `store_id` via `TenantStore`; optional Postgres RLS as a second wall (03).
2. **Agents:** the runner receives the tenant context; `salla_read` can only ever use that tenant's tokens (tokens are fetched inside the tool by `storeId`, never passed through the model).
3. **Prompt-injection blast radius:** store data (product names, reviews) enters prompts — a hostile review can try to manipulate an agent. Mitigations: agents remain read-only by architecture (worst case is bad advice, not store damage); memory writes are length/type-constrained; the curator never invents; cross-tenant leakage is impossible because no tool can address another `store_id`.
4. **Rate limits:** extend today's login lockout to per-account and per-IP across tenants; per-tenant API rate limits (chat especially) to contain abuse and cost.
5. **Audit:** append-only `audit_log(store_id, account_id, action, at)` for settings changes, memory deletions, token rotations, billing transitions.

## MCP in multi-tenant

- `POST /mcp` authenticates by integration token → tenant. The MCP server instance is built per request *with the tenant baked in* (the current stateless design already matches this).
- Quota: MCP `ask_manager` calls count against the chat quota (04).
- Scope note for merchants: the MCP token grants chat+reports for that one store only; rotating it in Settings severs external clients instantly.

## Platform admin (new, minimal)

A separate admin surface (separate credentials, ideally IP-restricted):
- tenant list with status/plan/usage/cost,
- impersonate-for-support (logged in `audit_log`, visible banner),
- per-tenant overrides (budget exceptions, comp plans),
- purge/retention controls.

Keep it as a guarded module in the same codebase (`/admin` + `requirePlatformAdmin`) — no second app needed at this scale.
