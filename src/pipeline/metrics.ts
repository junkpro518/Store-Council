import { JsonStore } from "../store/jsonStore.js";
import { sallaGet } from "../salla/client.js";

/**
 * Daily KPI time series. Captured at the start of every daily analysis so
 * agents compare against the store's real history instead of re-deriving it
 * from raw API pages each day — fewer API calls, sharper trend detection.
 */

export interface MetricsSnapshot {
  date: string; // YYYY-MM-DD
  orders: number | null;
  customers: number | null;
  products: number | null;
  abandonedCarts: number | null;
}

const store = new JsonStore<MetricsSnapshot[]>("metrics-history", []);
const MAX_DAYS = 365;

/** Total count from a Salla list endpoint via pagination metadata (1 call). */
async function countOf(endpoint: string): Promise<number | null> {
  try {
    const res = (await sallaGet(endpoint, { per_page: 1 })) as {
      pagination?: { total?: number };
    };
    return res.pagination?.total ?? null;
  } catch {
    return null;
  }
}

export async function captureSnapshot(date: string): Promise<MetricsSnapshot> {
  const [orders, customers, products, abandonedCarts] = await Promise.all([
    countOf("orders"),
    countOf("customers"),
    countOf("products"),
    countOf("carts/abandoned"),
  ]);
  const snapshot: MetricsSnapshot = { date, orders, customers, products, abandonedCarts };
  store.update((all) => [
    ...all.filter((s) => s.date !== date),
    snapshot,
  ].slice(-MAX_DAYS));
  return snapshot;
}

export function metricsHistory(days = 30): MetricsSnapshot[] {
  return store.read().slice(-days);
}
