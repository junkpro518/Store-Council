import crypto from "node:crypto";
import { getPgPool, loadTenant } from "../store/jsonStore.js";
import { findStoreByMerchant } from "../tenancy/registry.js";

/**
 * Merchant accounts & sessions (T018, specs/004-saas-conversion). SaaS mode
 * only — dedicated deployments keep the per-deployment owner password.
 *
 * Identity comes from "Sign in with Salla": the OAuth user maps to a tenant
 * via their merchant id. Session tokens are stored sha256-hashed; an
 * impersonation session (issued from the central panel, audited) carries a
 * distinguishable prefix so the UI can show a banner.
 */

interface PoolLike {
  query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

function pool(): PoolLike {
  const p = getPgPool();
  if (!p) throw new Error("Accounts require STORAGE=postgres.");
  return p as PoolLike;
}

const SESSION_TTL_DAYS = 30;

function hash(t: string): string {
  return crypto.createHash("sha256").update(t).digest("hex");
}

/** Find-or-create the account owning a store (one owner account per store). */
export async function ensureAccountForStore(
  storeId: string,
  identity: { sallaUserId?: number; email?: string; name?: string } = {}
): Promise<string> {
  const { rows: existing } = await pool().query(
    "select account_id from account_stores where store_id = $1 and role = 'owner' limit 1",
    [storeId]
  );
  if (existing[0]) {
    if (identity.sallaUserId) {
      await pool().query(
        "update accounts set salla_user_id = coalesce(salla_user_id, $2), email = coalesce(email, $3) where id = $1",
        [existing[0].account_id, identity.sallaUserId, identity.email ?? null]
      );
    }
    return String(existing[0].account_id);
  }
  const { rows } = await pool().query(
    `insert into accounts (salla_user_id, email)
     values ($1, $2)
     on conflict (salla_user_id) do update set email = coalesce(accounts.email, excluded.email)
     returning id`,
    [identity.sallaUserId ?? null, identity.email ?? null]
  );
  const accountId = String(rows[0].id);
  await pool().query(
    "insert into account_stores (account_id, store_id, role) values ($1, $2, 'owner') on conflict do nothing",
    [accountId, storeId]
  );
  return accountId;
}

/** Mint a merchant session for an account. Returns the plaintext token once. */
export async function createMerchantSession(
  accountId: string,
  impersonation = false
): Promise<string> {
  const token = (impersonation ? "sc_imp_" : "sc_mer_") + crypto.randomBytes(32).toString("hex");
  await pool().query(
    "insert into sessions (token, account_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)",
    [hash(token), accountId, String(impersonation ? 1 : SESSION_TTL_DAYS)]
  );
  return token;
}

export interface MerchantSession {
  accountId: string;
  storeId: string;
  role: string;
  impersonated: boolean;
}

/** Resolve a presented token to its tenant (and preload it), or null. */
export async function resolveMerchantSession(token: string): Promise<MerchantSession | null> {
  if (!token.startsWith("sc_mer_") && !token.startsWith("sc_imp_")) return null;
  const { rows } = await pool().query(
    `select s.account_id, a.store_id, a.role
     from sessions s join account_stores a on a.account_id = s.account_id
     where s.token = $1 and s.expires_at > now()
     limit 1`,
    [hash(token)]
  );
  if (!rows[0]) return null;
  const storeId = String(rows[0].store_id);
  await loadTenant(storeId);
  return {
    accountId: String(rows[0].account_id),
    storeId,
    role: String(rows[0].role),
    impersonated: token.startsWith("sc_imp_"),
  };
}

export async function revokeMerchantSession(token: string): Promise<void> {
  await pool().query("delete from sessions where token = $1", [hash(token)]);
}

/** Exchange a Salla OAuth code for an identity and map it to a tenant. */
export async function loginWithSalla(
  exchange: { accessToken: string },
  accountsBase: string
): Promise<{ storeId: string; token: string } | null> {
  const res = await fetch(`${accountsBase}/user/info`, {
    headers: { Authorization: `Bearer ${exchange.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const info = (await res.json()) as {
    data?: {
      id?: number;
      email?: string;
      name?: string;
      merchant?: { id?: number };
      store?: { id?: number };
    };
  };
  const merchantId = info.data?.merchant?.id ?? info.data?.store?.id;
  if (!merchantId) return null;
  const storeId = await findStoreByMerchant(Number(merchantId));
  if (!storeId) return null; // store must be installed first (webhook provisions)
  await loadTenant(storeId);
  const accountId = await ensureAccountForStore(storeId, {
    sallaUserId: info.data?.id,
    email: info.data?.email,
  });
  return { storeId, token: await createMerchantSession(accountId) };
}

/** Audit trail for sensitive operator actions (impersonation, purge...). */
export async function audit(
  storeId: string | null,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await pool().query(
    "insert into audit_log (store_id, actor, action, detail) values ($1, $2, $3, $4::jsonb)",
    [storeId, actor, action, JSON.stringify(detail)]
  );
}
