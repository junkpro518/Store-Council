import crypto from "node:crypto";
import { platformConfig } from "../platform/config.js";
import { getPgPool, loadTenant } from "../store/jsonStore.js";
import { DEFAULT_STORE_ID } from "./context.js";

/**
 * Tenant registry (T011/T012, specs/004-saas-conversion). Postgres-mode only:
 * the `stores` table is the source of truth for merchant→tenant routing, and
 * `integration_tokens` holds per-tenant MCP/API tokens (sha256-hashed at
 * rest; the plaintext is shown once at issuance).
 *
 * In json mode (single-store/dedicated tier) these functions are not used —
 * the deployment IS the tenant, exactly as before.
 */

interface PoolLike {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

function pool(): PoolLike {
  const p = getPgPool();
  if (!p) {
    throw new Error("Tenant registry requires STORAGE=postgres (initStorage first).");
  }
  return p as PoolLike;
}

export function multiTenant(): boolean {
  return platformConfig.storage === "postgres";
}

export async function findStoreByMerchant(merchantId: number): Promise<string | null> {
  const { rows } = await pool().query(
    "select id from stores where salla_merchant_id = $1",
    [merchantId]
  );
  return rows[0] ? String(rows[0].id) : null;
}

/**
 * Resolve the tenant for an inbound Salla event, provisioning when new.
 * Upgrade path: if the default (legacy single-store) tenant has no merchant
 * bound yet, the first merchant binds to it; every later merchant gets a
 * fresh trial tenant.
 */
export async function resolveOrProvision(merchantId: number): Promise<string> {
  const existing = await findStoreByMerchant(merchantId);
  if (existing) {
    await loadTenant(existing);
    return existing;
  }
  const { rows: def } = await pool().query(
    "select salla_merchant_id from stores where id = $1",
    [DEFAULT_STORE_ID]
  );
  if (def[0] && def[0].salla_merchant_id == null) {
    await pool().query("update stores set salla_merchant_id = $1 where id = $2", [
      merchantId,
      DEFAULT_STORE_ID,
    ]);
    return DEFAULT_STORE_ID;
  }
  const { rows } = await pool().query(
    `insert into stores (salla_merchant_id, status, trial_ends_at)
     values ($1, 'trial', now() + interval '7 days') returning id`,
    [merchantId]
  );
  const storeId = String(rows[0].id);
  await loadTenant(storeId);
  console.log(`[tenancy] provisioned trial tenant ${storeId} for merchant ${merchantId}`);
  return storeId;
}

export async function markUninstalled(storeId: string): Promise<void> {
  await pool().query(
    "update stores set status = 'uninstalled', uninstalled_at = now() where id = $1",
    [storeId]
  );
}

export async function markReinstalled(storeId: string): Promise<void> {
  await pool().query(
    "update stores set status = 'trial', uninstalled_at = null where id = $1 and status = 'uninstalled'",
    [storeId]
  );
}

/** Purge tenants whose 90-day post-uninstall retention has elapsed (T026). */
export async function purgeExpiredRetention(days = 90): Promise<number> {
  const { rows } = await pool().query(
    `delete from stores
     where status = 'uninstalled' and uninstalled_at < now() - ($1 || ' days')::interval
     returning id`,
    [String(days)]
  );
  return rows.length; // FK cascades wipe kv, jobs, tokens, ledger, subscriptions
}

/** Hard-delete one tenant now (operator-confirmed; audited by the caller). */
export async function purgeTenant(storeId: string): Promise<boolean> {
  const { rows } = await pool().query("delete from stores where id = $1 returning id", [storeId]);
  return rows.length > 0;
}

// ---------- Per-tenant integration tokens (hashed at rest) ----------

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Issue a new integration token for a tenant. Plaintext returned ONCE. */
export async function issueIntegrationToken(storeId: string): Promise<string> {
  const token = "sc_int_" + crypto.randomBytes(32).toString("hex");
  await pool().query(
    "insert into integration_tokens (token, store_id) values ($1, $2)",
    [hashToken(token), storeId]
  );
  return token;
}

/** Resolve a presented token to its tenant (and preload it), or null. */
export async function resolveIntegrationToken(token: string): Promise<string | null> {
  if (!token.startsWith("sc_int_")) return null;
  const { rows } = await pool().query(
    "select store_id from integration_tokens where token = $1",
    [hashToken(token)]
  );
  if (!rows[0]) return null;
  const storeId = String(rows[0].store_id);
  await loadTenant(storeId);
  return storeId;
}

export async function revokeIntegrationTokens(storeId: string): Promise<void> {
  await pool().query("delete from integration_tokens where store_id = $1", [storeId]);
}
