/**
 * Platform-level configuration (T003, specs/004-saas-conversion).
 *
 * Distinct from per-tenant settings (src/settings/settings.ts, dashboard-
 * editable) and from static app config (src/config.ts). These values belong
 * to the PLATFORM OPERATOR, come from the environment/secrets manager, and
 * are never exposed to tenants. Per the migration plan, the platform
 * OpenRouter key and Salla app credentials move here in Phase P4 — until
 * then tenant settings remain authoritative for those.
 */

export type StorageBackend = "json" | "postgres";

export const platformConfig = {
  /** Storage backend. "json" (default) keeps today's single-store behavior. */
  storage: (process.env.STORAGE === "postgres" ? "postgres" : "json") as StorageBackend,
  /** Required when storage = postgres. */
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** 32-byte hex key for encrypting tenant secrets at rest (P4). */
  encryptionKey: process.env.PLATFORM_ENCRYPTION_KEY ?? "",
  /**
   * Platform-level Salla webhook secret. One Salla app serves all tenants,
   * so signature verification happens before tenant routing. Falls back to
   * the default tenant's settings (legacy single-store behavior) when unset.
   */
  sallaWebhookSecret: process.env.SALLA_WEBHOOK_SECRET ?? "",
  /**
   * Platform-level Salla app credentials (one Salla app serves all tenants).
   * Required in SaaS mode for token refresh of provisioned tenants and for
   * login-with-Salla; the default tenant's settings remain the fallback for
   * dedicated deployments.
   */
  sallaClientId: process.env.SALLA_CLIENT_ID ?? "",
  sallaClientSecret: process.env.SALLA_CLIENT_SECRET ?? "",
  /** Override for tests/self-hosted gateways. */
  sallaAccountsBase: process.env.SALLA_ACCOUNTS_BASE ?? "https://accounts.salla.sa/oauth2",
  /** Worker tuning (P3). */
  worker: {
    /** Max LLM-heavy jobs running simultaneously across all tenants. */
    globalConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    /** Enqueuer tick interval. */
    tickMs: Number(process.env.WORKER_TICK_MS ?? 60_000),
  },
};

export function requireDatabaseUrl(): string {
  if (!platformConfig.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Postgres mode needs it, e.g. postgres://user:pass@localhost:5432/storecouncil"
    );
  }
  return platformConfig.databaseUrl;
}
