import { JsonStore } from "../store/jsonStore.js";

/**
 * Platform state for this tenant — managed from the central panel: the plan
 * the merchant subscribes to, whether the tenant is locked (e.g. unpaid),
 * and operator notes. In the SaaS conversion (docs/saas/) this becomes a row
 * per store; the shape is identical by design.
 */

export type PlanId = "trial" | "basic" | "pro" | "growth" | "custom";
export type TenantStatus = "active" | "locked";

export interface PlatformState {
  plan: PlanId;
  status: TenantStatus;
  notes: string;
  updatedAt: string;
}

const store = new JsonStore<PlatformState>("platform", {
  plan: "trial",
  status: "active",
  notes: "",
  updatedAt: "",
});

export function platformState(): PlatformState {
  return store.read();
}

export function updatePlatform(patch: Partial<Pick<PlatformState, "plan" | "status" | "notes">>): PlatformState {
  const current = store.read();
  const next: PlatformState = {
    ...current,
    ...(patch.plan && ["trial", "basic", "pro", "growth", "custom"].includes(patch.plan)
      ? { plan: patch.plan }
      : {}),
    ...(patch.status && ["active", "locked"].includes(patch.status)
      ? { status: patch.status }
      : {}),
    ...(patch.notes !== undefined ? { notes: String(patch.notes).slice(0, 2000) } : {}),
    updatedAt: new Date().toISOString(),
  };
  store.write(next);
  return next;
}

export function tenantLocked(): boolean {
  return store.read().status === "locked";
}
