/**
 * PLAN_MATRIX (T020, specs/004-saas-conversion) — the single place plans are
 * defined; every gate consumes this. Numbers per docs/saas/04-billing.md
 * (trial deviates from the listing table deliberately: full council + MCP,
 * tightly capped — the trial should taste everything).
 */

export type PlanId = "trial" | "basic" | "pro" | "growth" | "custom";

export interface Plan {
  /** Max enabled specialist managers in daily runs & chat (GM always free). */
  maxManagers: number;
  /** Forced model for the tier; null = the tenant's configured model. */
  model: string | null;
  /** User messages (dashboard chat + MCP) per calendar month. */
  chatPerMonth: number;
  /** Owner-triggered on-demand analyses per calendar month. */
  onDemandPerMonth: number;
  /** Token budget per day across all work (input+output). */
  tokensPerDay: number;
  mcpEnabled: boolean;
  impactEnabled: boolean;
}

export const PLAN_MATRIX: Record<PlanId, Plan> = {
  trial: {
    maxManagers: 15,
    model: null,
    chatPerMonth: 30,
    onDemandPerMonth: 2,
    tokensPerDay: 2_000_000,
    mcpEnabled: true,
    impactEnabled: true,
  },
  basic: {
    maxManagers: 5,
    model: "openai/gpt-4o-mini",
    chatPerMonth: 100,
    onDemandPerMonth: 2,
    tokensPerDay: 1_500_000,
    mcpEnabled: false,
    impactEnabled: false,
  },
  pro: {
    maxManagers: 15,
    model: null,
    chatPerMonth: 600,
    onDemandPerMonth: 15,
    tokensPerDay: 6_000_000,
    mcpEnabled: false,
    impactEnabled: true,
  },
  growth: {
    maxManagers: 15,
    model: null,
    chatPerMonth: 2_500,
    onDemandPerMonth: 60,
    tokensPerDay: 20_000_000,
    mcpEnabled: true,
    impactEnabled: true,
  },
  custom: {
    maxManagers: 15,
    model: null,
    chatPerMonth: 100_000,
    onDemandPerMonth: 1_000,
    tokensPerDay: 100_000_000,
    mcpEnabled: true,
    impactEnabled: true,
  },
};

export function planOf(id: string | undefined): Plan {
  return PLAN_MATRIX[(id as PlanId) ?? "trial"] ?? PLAN_MATRIX.trial;
}
