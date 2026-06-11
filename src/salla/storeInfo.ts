import { JsonStore } from "../store/jsonStore.js";
import { sallaGet } from "./client.js";
import { isConnected } from "./auth.js";

/** Cached store identity, shown in the dashboard header. */

export interface StoreInfo {
  name: string;
  domain: string;
  plan: string;
  fetchedAt: number;
}

const cache = new JsonStore<StoreInfo | null>("store-info", null);
const TTL_MS = 12 * 60 * 60 * 1000;

export async function getStoreInfo(force = false): Promise<StoreInfo | null> {
  if (!isConnected()) return null;
  const cached = cache.read();
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  try {
    const res = (await sallaGet("store/info")) as {
      data?: { name?: string; domain?: string; plan?: string };
    };
    const info: StoreInfo = {
      name: res.data?.name ?? "",
      domain: res.data?.domain ?? "",
      plan: res.data?.plan ?? "",
      fetchedAt: Date.now(),
    };
    cache.write(info);
    return info;
  } catch {
    return cached; // stale is better than nothing for a header label
  }
}

export function clearStoreInfoCache(): void {
  cache.write(null);
}
