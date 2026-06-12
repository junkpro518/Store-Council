import { getPgPool, JsonStore, loadTenant } from "../store/jsonStore.js";
import { runWithTenant } from "../tenancy/context.js";

/**
 * Salla subscription lifecycle (T019, specs/004-saas-conversion).
 *
 * Webhooks are the source of truth. Handlers are deliberately tolerant about
 * exact event suffixes and plan-name fields (Salla payload shapes vary by
 * app configuration — verify the configured names in the Partners portal at
 * listing time; unknown app.subscription.* events are logged, never dropped
 * silently). State is written twice, on purpose:
 *   - stores.status + subscriptions row (SQL; what the enqueuer/registry use)
 *   - per-tenant kv "platform" {plan, status} (what sync in-request gates read)
 */

export type TenantStatus = "trial" | "active" | "past_due" | "locked" | "uninstalled";

interface PoolLike {
  query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

function pool(): PoolLike {
  const p = getPgPool();
  if (!p) throw new Error("Billing requires STORAGE=postgres.");
  return p as PoolLike;
}

const platformKv = new JsonStore<{ plan: string; status: string; notes: string; updatedAt: string }>(
  "platform",
  { plan: "trial", status: "active", notes: "", updatedAt: "" }
);

/** Mirror plan/status into the tenant's kv so sync request-path gates see it. */
async function syncTenantKv(storeId: string, plan: string | null, status: TenantStatus): Promise<void> {
  await loadTenant(storeId);
  runWithTenant(storeId, () => {
    platformKv.update((p) => ({
      ...p,
      ...(plan ? { plan } : {}),
      // kv "status" keeps its legacy two-value shape for the lock gate.
      status: status === "locked" || status === "uninstalled" ? "locked" : "active",
      updatedAt: new Date().toISOString(),
    }));
  });
}

function extractPlan(data: Record<string, unknown>): string {
  const raw = String(data.plan_name ?? data.plan ?? data.plan_type ?? data.name ?? "");
  const m = raw.toLowerCase().match(/basic|pro|growth|custom|trial/);
  return m ? m[0] : "pro";
}

const GRACE_DAYS = 7;

/**
 * Handle an app.subscription.* / app.trial.* event for an already-routed
 * tenant. Returns a human summary for the webhook log.
 */
export async function handleSubscriptionEvent(
  storeId: string,
  event: string,
  data: Record<string, unknown>
): Promise<string> {
  const suffix = event.replace(/^app\.(subscription|trial)\./, "");
  const isTrial = event.startsWith("app.trial.");
  const raw = JSON.stringify(data).slice(0, 4000);

  if (/^(started|activated|created|renewed)$/.test(suffix)) {
    const plan = isTrial ? "trial" : extractPlan(data);
    const status: TenantStatus = isTrial ? "trial" : "active";
    await pool().query(
      `insert into subscriptions (store_id, plan, status, started_at, renews_at, raw)
       values ($1, $2, 'active', now(), null, $3::jsonb)
       on conflict (store_id) do update set
         plan = excluded.plan, status = 'active', renews_at = null,
         canceled_at = null, raw = excluded.raw`,
      [storeId, plan, raw]
    );
    await pool().query("update stores set status = $2 where id = $1", [storeId, status]);
    await syncTenantKv(storeId, plan, status);
    return `subscription ${suffix}: plan=${plan}, tenant ${status}`;
  }

  if (/^(canceled|cancelled)$/.test(suffix)) {
    // Service continues until the period ends (the expiry event locks).
    await pool().query(
      "update subscriptions set status = 'canceled', canceled_at = now(), raw = $2::jsonb where store_id = $1",
      [storeId, raw]
    );
    return "subscription canceled (service until period end)";
  }

  if (/^(expired|ended)$/.test(suffix)) {
    const grace = new Date(Date.now() + GRACE_DAYS * 24 * 3600 * 1000).toISOString();
    await pool().query(
      `insert into subscriptions (store_id, plan, status, raw)
       values ($1, 'trial', 'expired', $2::jsonb)
       on conflict (store_id) do update set status = 'expired',
         raw = coalesce(subscriptions.raw, '{}'::jsonb) || jsonb_build_object('grace_until', $3::text)`,
      [storeId, raw, grace]
    );
    await pool().query("update stores set status = 'past_due' where id = $1", [storeId]);
    await syncTenantKv(storeId, null, "past_due"); // kv stays "active" (grace) — banner only
    return `subscription expired: grace until ${grace.slice(0, 10)}`;
  }

  console.warn(`[billing] unhandled subscription event "${event}" for ${storeId}`);
  return `unhandled subscription event ${event} (recorded)`;
}

/**
 * Lock tenants whose past-due grace has elapsed. Idempotent; the worker
 * calls this every tick. Returns the number of tenants locked.
 */
export async function lockExpiredGraces(): Promise<number> {
  const { rows } = await pool().query(
    `update stores set status = 'locked'
     where status = 'past_due'
       and id in (
         select store_id from subscriptions
         where status = 'expired'
           and (raw->>'grace_until') is not null
           and (raw->>'grace_until')::timestamptz < now()
       )
     returning id`
  );
  for (const row of rows) await syncTenantKv(String(row.id), null, "locked");
  return rows.length;
}

/** Central-panel override of a tenant's plan/status (audited by the caller). */
export async function adminSetTenant(
  storeId: string,
  patch: { plan?: string; status?: TenantStatus }
): Promise<void> {
  if (patch.status) {
    await pool().query("update stores set status = $2 where id = $1", [storeId, patch.status]);
  }
  if (patch.plan) {
    await pool().query(
      `insert into subscriptions (store_id, plan, status) values ($1, $2, 'active')
       on conflict (store_id) do update set plan = excluded.plan`,
      [storeId, patch.plan]
    );
  }
  const { rows } = await pool().query("select status from stores where id = $1", [storeId]);
  await syncTenantKv(storeId, patch.plan ?? null, (rows[0]?.status as TenantStatus) ?? "active");
}

/** Tenant status from the SQL source of truth (boundaries that can await). */
export async function tenantStatus(storeId: string): Promise<TenantStatus> {
  const { rows } = await pool().query("select status from stores where id = $1", [storeId]);
  return (rows[0]?.status as TenantStatus) ?? "uninstalled";
}
