import { AsyncLocalStorage } from "node:async_hooks";

/** The legacy/dedicated single-store tenant. */
export const DEFAULT_STORE_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Tenant context (T010, specs/004-saas-conversion).
 *
 * Multi-tenancy is threaded with AsyncLocalStorage instead of changing every
 * function signature: boundaries (webhook router, MCP auth, HTTP middleware,
 * P3 jobs) call runWithTenant(storeId, fn); everything inside — agent loops,
 * tools, pipeline, every JsonStore read/write — automatically operates on
 * that tenant. Code outside any context uses the default store, which is
 * exactly the legacy single-store behavior.
 */

const als = new AsyncLocalStorage<{ storeId: string }>();

export function currentStoreId(): string {
  return als.getStore()?.storeId ?? DEFAULT_STORE_ID;
}

export function runWithTenant<T>(storeId: string, fn: () => T): T {
  return als.run({ storeId }, fn);
}
