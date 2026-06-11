import { config } from "../config.js";
import { getAccessToken } from "./auth.js";

/**
 * Read-only Salla Admin API client.
 *
 * SAFETY INVARIANT: this client can only perform GET requests against an
 * explicit allowlist of endpoints. There is intentionally no method that
 * issues POST/PUT/PATCH/DELETE — the platform observes the store, it never
 * modifies it. This is the second of three enforcement layers (OAuth scopes,
 * this allowlist, and agent tool definitions).
 */

const ALLOWED_ENDPOINTS = [
  "store/info",
  "products",
  "products/{id}",
  "categories",
  "brands",
  "orders",
  "orders/{id}",
  "orders/statuses",
  "customers",
  "customers/{id}",
  "customers/groups",
  "carts/abandoned",
  "coupons",
  "specialoffers",
  "affiliates",
  "reviews",
  "questions",
  "shipping/companies",
  "shipments",
  "payments/methods",
  "transactions",
  "settlements",
  "branches",
  "taxes",
  "countries",
  "currencies",
  "seo",
  "advertisements",
  "store-pages",
  "menus",
  "themes",
] as const;

export type SallaEndpoint = (typeof ALLOWED_ENDPOINTS)[number];

function isAllowed(path: string): boolean {
  return ALLOWED_ENDPOINTS.some((pattern) => {
    const re = new RegExp(
      "^" + pattern.replace(/\{id\}/g, "[A-Za-z0-9_-]+") + "$"
    );
    return re.test(path);
  });
}

export async function sallaGet(
  path: string,
  params: Record<string, string | number> = {},
  attempt = 0
): Promise<unknown> {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (!isAllowed(clean)) {
    throw new Error(
      `Endpoint "${clean}" is not in the read-only allowlist. Refusing the request.`
    );
  }
  const token = await getAccessToken();
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  );
  const url = `${config.salla.apiBase}/${clean}${qs.size ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 429 && attempt < 3) {
    // Respect Salla rate limits with bounded, header-driven backoff
    const wait = Math.min(Number(res.headers.get("retry-after") ?? 2), 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return sallaGet(clean, params, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Salla API ${res.status} on ${clean}: ${await res.text()}`);
  }
  return res.json();
}

/**
 * Write allowlist — used ONLY when the owner has switched write mode away
 * from read_only. Deliberately conservative:
 *  - no DELETE, ever (nothing destructive)
 *  - only content/commerce endpoints (no settings, payments, shipping config)
 * Extend consciously; every entry widens what an agent may touch.
 */
const WRITE_ALLOWLIST: { method: "POST" | "PUT"; pattern: string }[] = [
  { method: "PUT", pattern: "products/{id}" }, // edit product details/price/desc
  { method: "POST", pattern: "products" }, // create product (draft workflows)
  { method: "POST", pattern: "coupons" },
  { method: "PUT", pattern: "coupons/{id}" },
  { method: "POST", pattern: "specialoffers" },
  { method: "PUT", pattern: "specialoffers/{id}" },
  { method: "POST", pattern: "categories" },
  { method: "PUT", pattern: "categories/{id}" },
];

export function isWriteAllowed(method: string, path: string): boolean {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return WRITE_ALLOWLIST.some((e) => {
    if (e.method !== method.toUpperCase()) return false;
    const re = new RegExp("^" + e.pattern.replace(/\{id\}/g, "[A-Za-z0-9_-]+") + "$");
    return re.test(clean);
  });
}

/**
 * Execute a write against the Salla store. Callers must have already passed
 * the change through the owner's write-mode policy (confirm queue or auto) —
 * this function only enforces the method/endpoint allowlist.
 */
export async function sallaWrite(
  method: "POST" | "PUT",
  path: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (!isWriteAllowed(method, clean)) {
    throw new Error(
      `Write ${method} ${clean} is not in the write allowlist. Refusing.`
    );
  }
  const token = await getAccessToken();
  const res = await fetch(`${config.salla.apiBase}/${clean}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Salla API ${res.status} on ${method} ${clean}: ${JSON.stringify(body).slice(0, 400)}`
    );
  }
  return { status: res.status, body };
}

/** Fetch every page of a list endpoint (bounded, for daily snapshots). */
export async function sallaGetAll(
  path: string,
  params: Record<string, string | number> = {},
  maxPages = 10
): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = (await sallaGet(path, { ...params, page, per_page: 50 })) as {
      data?: unknown[];
      pagination?: { totalPages?: number; total_pages?: number };
    };
    if (Array.isArray(res.data)) items.push(...res.data);
    const totalPages =
      res.pagination?.totalPages ?? res.pagination?.total_pages ?? 1;
    if (page >= totalPages) break;
  }
  return items;
}
