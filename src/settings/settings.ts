import { JsonStore } from "../store/jsonStore.js";

/**
 * Runtime platform settings — every knob the store owner can change from the
 * dashboard without touching code or environment variables. Environment
 * variables act only as initial defaults; the saved settings file wins.
 */

export interface AgentOverride {
  /** Disabled agents are skipped in daily analysis and cannot be chatted with. */
  enabled: boolean;
  /** Owner-chosen display name (e.g. rename "Pricing Manager" to "أبو فهد"). */
  displayName?: string;
  /** Extra standing instructions appended to the agent's system prompt. */
  customInstructions?: string;
  /** Replace the agent's standing focus areas entirely (optional). */
  focus?: string[];
}

export interface PlatformSettings {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env if empty. */
  anthropicApiKey: string;
  model: string;
  /** "ar" = always Arabic, "en" = always English, "auto" = mirror the owner. */
  language: "ar" | "en" | "auto";
  /** Free-text store context the owner writes (niche, goals, constraints). */
  storeContext: string;
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
  };
  agents: Record<string, AgentOverride>;
}

const defaults: PlatformSettings = {
  anthropicApiKey: "",
  model: "claude-opus-4-8",
  language: "auto",
  storeContext: "",
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
    salla: { ...defaults.salla, ...saved.salla },
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
    agents: { ...current.agents, ...(patch.agents ?? {}) },
  };
  next.analysisConcurrency = clampInt(next.analysisConcurrency, 1, 8, 4);
  next.topActionsCount = clampInt(next.topActionsCount, 3, 10, 5);
  if (!["ar", "en", "auto"].includes(next.language)) next.language = "auto";
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

export function anthropicKey(): string {
  return getSettings().anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
