import { JsonStore } from "../store/jsonStore.js";

/**
 * Runtime platform settings — every knob the store owner can change from the
 * dashboard without touching code or environment variables. Environment
 * variables act only as initial defaults; the saved settings file wins.
 */

export type WriteMode = "read_only" | "confirm" | "auto";

export interface AgentOverride {
  /** Disabled agents are skipped in daily analysis and cannot be chatted with. */
  enabled: boolean;
  /** Per-agent write mode; "inherit" uses the global writeMode. */
  writeMode?: WriteMode | "inherit";
  /** Owner-chosen display name (e.g. rename "Pricing Manager" to "أبو فهد"). */
  displayName?: string;
  /** Extra standing instructions appended to the agent's system prompt. */
  customInstructions?: string;
  /** Replace the agent's standing focus areas entirely (optional). */
  focus?: string[];
}

export interface PlatformSettings {
  /** Sole LLM provider. Kept as a field for forward-compatibility; coerced to "openrouter". */
  provider: "openrouter";
  openRouter: {
    /** OpenRouter API key (openrouter.ai). Falls back to OPENROUTER_API_KEY env. */
    apiKey: string;
    /** Any model id from openrouter.ai/models that supports tool calling. */
    model: string;
  };
  /** "ar" = always Arabic, "en" = always English, "auto" = mirror the owner. */
  language: "ar" | "en" | "auto";
  /** Free-text store context the owner writes (niche, goals, constraints). */
  storeContext: string;
  /**
   * Global write mode for agents:
   *  - read_only: agents can never modify the store (default)
   *  - confirm:   agents propose changes; the owner approves each one
   *  - auto:      approved-allowlist changes apply immediately (use with care)
   */
  writeMode: WriteMode;
  dailyEnabled: boolean;
  dailyCron: string;
  timezone: string;
  analysisConcurrency: number;
  /** How many top actions the General Manager puts in the daily report. */
  topActionsCount: number;
  salla: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    /** Webhook signing secret from the Salla Partners portal (HMAC-SHA256). */
    webhookSecret: string;
  };
  agents: Record<string, AgentOverride>;
}

const defaults: PlatformSettings = {
  // The platform routes ALL LLM transactions through OpenRouter — one account,
  // one bill, any tool-calling model on openrouter.ai/models.
  provider: "openrouter",
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model: "openai/gpt-4o",
  },
  language: "auto",
  storeContext: "",
  writeMode: "read_only",
  dailyEnabled: true,
  dailyCron: process.env.DAILY_CRON ?? "0 5 * * *",
  timezone: "Asia/Riyadh",
  analysisConcurrency: 4,
  topActionsCount: 5,
  salla: {
    clientId: process.env.SALLA_CLIENT_ID ?? "",
    clientSecret: process.env.SALLA_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.SALLA_REDIRECT_URI ??
      "http://localhost:3000/auth/salla/callback",
    webhookSecret: process.env.SALLA_WEBHOOK_SECRET ?? "",
  },
  agents: {},
};

const store = new JsonStore<PlatformSettings>("settings", defaults);

export function getSettings(): PlatformSettings {
  // Merge over defaults so new fields added in upgrades pick up sane values.
  const saved = store.read();
  return {
    ...defaults,
    ...saved,
    // OpenRouter is the sole LLM provider — never honor a stale "anthropic".
    provider: "openrouter",
    salla: { ...defaults.salla, ...saved.salla },
    openRouter: { ...defaults.openRouter, ...saved.openRouter },
    agents: saved.agents ?? {},
  };
}

export function updateSettings(
  patch: Partial<PlatformSettings>
): PlatformSettings {
  const current = getSettings();
  const next: PlatformSettings = {
    ...current,
    ...patch,
    salla: { ...current.salla, ...(patch.salla ?? {}) },
    openRouter: { ...current.openRouter, ...(patch.openRouter ?? {}) },
    agents: { ...current.agents, ...(patch.agents ?? {}) },
  };
  next.analysisConcurrency = clampInt(next.analysisConcurrency, 1, 8, 4);
  next.topActionsCount = clampInt(next.topActionsCount, 3, 10, 5);
  if (!["ar", "en", "auto"].includes(next.language)) next.language = "auto";
  // The platform routes every LLM transaction through OpenRouter; the provider
  // is coerced so no Anthropic-direct call can be made, even from an old file.
  next.provider = "openrouter";
  if (!["read_only", "confirm", "auto"].includes(next.writeMode)) next.writeMode = "read_only";
  store.write(next);
  return next;
}

export function setAgentOverride(
  agentId: string,
  patch: Partial<AgentOverride>
): PlatformSettings {
  const current = getSettings();
  const existing: AgentOverride = current.agents[agentId] ?? { enabled: true };
  return updateSettings({
    agents: { ...current.agents, [agentId]: { ...existing, ...patch } },
  });
}

export function agentOverride(agentId: string): AgentOverride {
  return getSettings().agents[agentId] ?? { enabled: true };
}

export function openRouterKey(): string {
  return getSettings().openRouter.apiKey || process.env.OPENROUTER_API_KEY || "";
}

/** True when the OpenRouter API key is configured. */
export function aiConfigured(): boolean {
  return Boolean(openRouterKey());
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
