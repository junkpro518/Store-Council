/**
 * Two-tenant isolation test (T013 → SC-1, specs/004-saas-conversion).
 * Requires a migrated Postgres and a free port:
 *
 *   DATABASE_URL=postgres://... npx tsx tests/tenant-isolation.ts
 *
 * Proves with a real server that two merchants' data never touch:
 * webhook routing/provisioning, event feeds, reports via MCP, memory via
 * the dashboard API, Salla tokens at rest, and token-scope boundaries.
 */
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const PORT = 3079;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "platform-webhook-secret";
const DEFAULT_ID = "00000000-0000-0000-0000-000000000001";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sign = (body: string) =>
  crypto.createHmac("sha256", SECRET).update(body).digest("hex");
const j = (r: Response) => r.json() as Promise<Record<string, unknown>>;

async function webhook(event: string, merchant: number, data: object): Promise<Response> {
  const body = JSON.stringify({ event, merchant, data, nonce: crypto.randomUUID() });
  return fetch(`${BASE}/webhooks/salla`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-salla-signature": sign(body) },
    body,
  });
}

async function mcpCall(token: string, name: string, args: object): Promise<string> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (res.status === 401) return "__401__";
  const text = await res.text();
  const data = text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}";
  const parsed = JSON.parse(data) as {
    result?: { content?: { text?: string }[] };
  };
  return parsed.result?.content?.[0]?.text ?? "";
}

// ---------- clean slate BEFORE the server boots (it preloads its cache) ----------
const { default: pg } = await import("pg");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query("delete from kv_state");
await db.query("delete from integration_tokens");
await db.query(`delete from stores where id <> '${DEFAULT_ID}'`);
await db.query(`update stores set salla_merchant_id = null where id = '${DEFAULT_ID}'`);

// ---------- boot server (production entry, postgres mode) ----------
execFileSync("npm", ["run", "build"], { stdio: "ignore" });
fs.rmSync("/tmp/iso-empty", { recursive: true, force: true });
fs.mkdirSync("/tmp/iso-empty");
const server = spawn("node", ["dist/server.js"], {
  env: {
    ...process.env,
    STORAGE: "postgres",
    DATA_DIR: "/tmp/iso-empty",
    PORT: String(PORT),
    SALLA_WEBHOOK_SECRET: SECRET,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
await new Promise<void>((resolve) => {
  server.stdout.on("data", (d) => {
    if (String(d).includes("dashboard:")) resolve();
  });
});

try {
  // ---------- Tenant A: owner setup on the default store ----------
  const { token: ownerToken } = (await j(
    await fetch(`${BASE}/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "isolation123" }),
    })
  )) as { token: string };
  check("owner (tenant A) setup", Boolean(ownerToken));

  // ---------- Webhook routing: A binds default, B gets provisioned ----------
  await webhook("app.store.authorize", 111, {
    access_token: "at_A",
    refresh_token: "rt_A",
    expires: 4102444800,
  });
  await webhook("app.store.authorize", 222, {
    access_token: "at_B",
    refresh_token: "rt_B",
    expires: 4102444800,
  });
  const stores = await db.query("select id, salla_merchant_id, status from stores order by created_at");
  check("merchant 111 bound to default store (upgrade path)",
    stores.rows.some((r) => r.id === DEFAULT_ID && Number(r.salla_merchant_id) === 111));
  const storeB = stores.rows.find((r) => Number(r.salla_merchant_id) === 222);
  check("merchant 222 auto-provisioned as trial tenant",
    Boolean(storeB) && storeB!.status === "trial");

  // ---------- Salla tokens at rest are per-tenant ----------
  const tok = await db.query("select store_id, value->>'access_token' as at from kv_state where kind='salla-tokens'");
  check("salla tokens isolated per store",
    tok.rows.length === 2 &&
    tok.rows.find((r) => r.store_id === DEFAULT_ID)?.at === "at_A" &&
    tok.rows.find((r) => r.store_id === storeB!.id)?.at === "at_B");

  // ---------- Event feeds don't leak ----------
  await webhook("order.created", 222, { reference_id: 9999 });
  const eventsA = (await j(
    await fetch(`${BASE}/store/events`, { headers: { authorization: `Bearer ${ownerToken}` } })
  )) as unknown as { event: string; summary: string }[];
  check("tenant A feed does NOT contain B's order",
    !JSON.stringify(eventsA).includes("9999"));
  const evB = await db.query("select value from kv_state where kind='webhook-events' and store_id=$1", [storeB!.id]);
  check("B's order recorded in B's feed",
    JSON.stringify(evB.rows[0]?.value ?? "").includes("9999"));

  // ---------- Seed B's private history, then probe every read surface ----------
  await db.query(
    `insert into kv_state (store_id, kind, value) values
     ($1, 'daily-reports', $2::jsonb),
     ($1, 'agent-memory', $3::jsonb)
     on conflict (store_id, kind) do update set value = excluded.value`,
    [
      storeB!.id,
      JSON.stringify([{ date: "2026-06-11", startedAt: "", finishedAt: "", summary: "تقرير المتجر ب السري", departments: {}, actions: [] }]),
      JSON.stringify({ pricing: [{ id: "x", type: "fact", content: "سر المتجر ب", createdAt: "2026-06-11T00:00:00Z" }] }),
    ]
  );
  // External writers must NOTIFY so live processes refresh their cache —
  // this is the coherence contract (and what the importer relies on too).
  for (const kind of ["daily-reports", "agent-memory"]) {
    await db.query("select pg_notify('kv_changed', $1)", [
      JSON.stringify({ kind, storeId: storeB!.id, src: "test-seeder" }),
    ]);
  }
  await new Promise((r) => setTimeout(r, 500));

  // Dashboard (owner session = tenant A) must see none of it
  const memA = (await j(
    await fetch(`${BASE}/agents/pricing/memory`, { headers: { authorization: `Bearer ${ownerToken}` } })
  )) as unknown as unknown[];
  check("A's dashboard memory view empty (B's memory invisible)", Array.isArray(memA) && memA.length === 0);
  const repA = await fetch(`${BASE}/reports/latest`, { headers: { authorization: `Bearer ${ownerToken}` } });
  check("A has no reports (B's report invisible)", repA.status === 404);

  // MCP per-tenant tokens
  const tokenB = "sc_int_" + crypto.randomBytes(32).toString("hex");
  await db.query("insert into integration_tokens (token, store_id) values ($1, $2)", [
    crypto.createHash("sha256").update(tokenB).digest("hex"),
    storeB!.id,
  ]);
  const reportViaB = await mcpCall(tokenB, "get_daily_report", {});
  check("MCP with B's token returns B's report", reportViaB.includes("تقرير المتجر ب السري"));
  const reportViaA = await mcpCall(ownerToken, "get_daily_report", {});
  check("MCP with A's session sees no reports", reportViaA.includes("No reports yet"));
  check("MCP with garbage token rejected", (await mcpCall("sc_int_deadbeef", "get_daily_report", {})) === "__401__");

  // Integration tokens must not open the merchant dashboard
  const dashWithB = await fetch(`${BASE}/agents`, { headers: { authorization: `Bearer ${tokenB}` } });
  check("B's MCP token rejected by dashboard routes", dashWithB.status === 401);

  // ---------- Uninstall isolates too ----------
  await webhook("app.uninstalled", 222, {});
  const after = await db.query("select status from stores where id = $1", [storeB!.id]);
  check("B uninstalled (retention countdown)", after.rows[0]?.status === "uninstalled");
  check("B's token revoked on uninstall", (await mcpCall(tokenB, "get_daily_report", {})) === "__401__");
  const statusA = (await j(await fetch(`${BASE}/auth/status`))) as { storeConnected: boolean };
  check("A unaffected by B's uninstall", statusA.storeConnected === true);
} finally {
  server.kill("SIGTERM");
  await db.end();
  fs.rmSync("/tmp/iso-empty", { recursive: true, force: true });
}

console.log(failures === 0 ? "\nTenant isolation all green ✅ (SC-1)" : `\n${failures} failed ❌`);
process.exit(failures === 0 ? 0 : 1);
