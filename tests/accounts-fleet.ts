/**
 * Accounts & fleet test (T018/T022/T024–T026). Requires a migrated Postgres:
 *
 *   DATABASE_URL=postgres://... npx tsx tests/accounts-fleet.ts
 *
 * Proves with the production server + a mock Salla accounts service:
 * login-with-Salla → per-tenant merchant session → multi-tenant DASHBOARD
 * (chat lands in the right tenant) → billing/usage card data → admin fleet
 * list/plan override → audited impersonation (banner flag) → lock via fleet →
 * 402 for the merchant → retention purge.
 */
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";

process.env.STORAGE = "postgres";
process.env.DATA_DIR = "/tmp/acct-inproc";

const PORT = 3083;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "acct-secret";
const DEFAULT_ID = "00000000-0000-0000-0000-000000000001";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sign = (b: string) => crypto.createHmac("sha256", SECRET).update(b).digest("hex");
async function webhook(event: string, merchant: number, data: object): Promise<void> {
  const body = JSON.stringify({ event, merchant, data, nonce: crypto.randomUUID() });
  await fetch(`${BASE}/webhooks/salla`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-salla-signature": sign(body) },
    body,
  });
}

// ---------- mock Salla accounts (token + user/info) and mock LLM ----------
const sallaMock = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url?.endsWith("/token")) {
    res.end(JSON.stringify({ access_token: "at_login", refresh_token: "rt", expires_in: 3600 }));
  } else if (req.url?.endsWith("/user/info")) {
    res.end(JSON.stringify({ data: { id: 9001, email: "merchant@example.com", merchant: { id: 777 } } }));
  } else {
    res.statusCode = 404;
    res.end("{}");
  }
});
await new Promise<void>((r) => sallaMock.listen(4996, "127.0.0.1", r));
const llmMock = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "إجابة المدير" } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    }));
  });
});
await new Promise<void>((r) => llmMock.listen(4995, "127.0.0.1", r));

// ---------- clean DB, boot production server ----------
const { default: pg } = await import("pg");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
for (const q of [
  "delete from kv_state", "delete from integration_tokens", "delete from jobs",
  "delete from usage_ledger", "delete from subscriptions", "delete from sessions",
  "delete from account_stores", "delete from accounts", "delete from audit_log",
  `delete from stores where id <> '${DEFAULT_ID}'`,
  `update stores set salla_merchant_id = null, status='trial', uninstalled_at=null where id = '${DEFAULT_ID}'`,
]) await db.query(q);

execFileSync("npm", ["run", "build"], { stdio: "ignore" });
fs.rmSync("/tmp/acct-empty", { recursive: true, force: true });
fs.mkdirSync("/tmp/acct-empty");
const server = spawn("node", ["dist/server.js"], {
  env: {
    ...process.env, STORAGE: "postgres", DATA_DIR: "/tmp/acct-empty",
    PORT: String(PORT), SALLA_WEBHOOK_SECRET: SECRET,
    SALLA_CLIENT_ID: "cid", SALLA_CLIENT_SECRET: "csecret",
    SALLA_ACCOUNTS_BASE: "http://127.0.0.1:4996/oauth2",
    OPENROUTER_BASE_URL: "http://127.0.0.1:4995/api/v1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
await new Promise<void>((r) => server.stdout.on("data", (d) => String(d).includes("dashboard:") && r()));

// admin session for fleet checks
const { token: adminToken } = (await (await fetch(`${BASE}/admin/auth/setup`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "admin-secret-123" }),
})).json()) as { token: string };

try {
  // ---------- install two tenants (avoid default-binding for tenant under test) ----------
  await webhook("app.store.authorize", 111, { access_token: "a", refresh_token: "r", expires: 4102444800 });
  await webhook("app.store.authorize", 777, { access_token: "a7", refresh_token: "r7", expires: 4102444800 });
  const { rows: tRow } = await db.query("select id from stores where salla_merchant_id = 777");
  const tenant = String(tRow[0].id);

  // seed tenant LLM settings
  await db.query(
    `insert into kv_state (store_id, kind, value) values ($1, 'settings', '{"openRouter":{"apiKey":"sk-or-mock","model":"m/x"}}'::jsonb)
     on conflict (store_id, kind) do update set value = excluded.value`, [tenant]);
  await db.query("select pg_notify('kv_changed', $1)", [JSON.stringify({ kind: "settings", storeId: tenant, src: "t" })]);

  // ---------- login with Salla (full OAuth round trip against the mock) ----------
  const start = await fetch(`${BASE}/auth/salla/login`, { redirect: "manual" });
  const loc = start.headers.get("location") ?? "";
  check("login redirects to Salla authorize", loc.includes("127.0.0.1:4996") && loc.includes("state=login_"), loc.slice(0, 70));
  const stateParam = new URL(loc).searchParams.get("state")!;
  const cb = await fetch(`${BASE}/auth/salla/login/callback?code=abc&state=${stateParam}`);
  const cbHtml = await cb.text();
  const session = cbHtml.match(/sc_token",\s*"([^"]+)"/)?.[1] ?? "";
  check("callback mints merchant session", session.startsWith("sc_mer_"), session.slice(0, 12));

  // ---------- the dashboard is now multi-tenant ----------
  const status = (await (await fetch(`${BASE}/auth/status`, {
    headers: { authorization: `Bearer ${session}` } })).json()) as Record<string, never>;
  check("status: authenticated SaaS merchant on trial",
    status.authenticated === true && status.saas === true && (status.tenant as { plan?: string })?.plan === "trial",
    JSON.stringify(status.tenant));
  const chat = await fetch(`${BASE}/agents/pricing/chat`, {
    method: "POST",
    headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
    body: JSON.stringify({ message: "كيف الأسعار؟" }),
  });
  const chatBody = (await chat.json()) as { reply?: string };
  check("merchant session chats with own council", chatBody.reply?.includes("إجابة المدير") === true);
  await new Promise((r) => setTimeout(r, 600));
  const { rows: hist } = await db.query(
    "select value from kv_state where kind = 'chat-history' and store_id = $1", [tenant]);
  check("chat history landed in the RIGHT tenant", JSON.stringify(hist[0]?.value ?? "").includes("كيف الأسعار؟"));
  const { rows: histA } = await db.query(
    "select value from kv_state where kind = 'chat-history' and store_id = $1", [DEFAULT_ID]);
  check("…and not in the other tenant", !JSON.stringify(histA[0]?.value ?? "").includes("كيف الأسعار"));

  // ---------- billing/usage card data ----------
  const usage = (await (await fetch(`${BASE}/billing/usage`, {
    headers: { authorization: `Bearer ${session}` } })).json()) as {
    plan: string; limits: { chatPerMonth: number }; usage: { messagesThisMonth: number };
  };
  check("plan & usage endpoint", usage.plan === "trial" && usage.usage.messagesThisMonth >= 1 && usage.limits.chatPerMonth === 30,
    JSON.stringify(usage.usage));

  // ---------- fleet: list, plan override, impersonation, lock ----------
  const fleet = (await (await fetch(`${BASE}/admin/tenants`, {
    headers: { authorization: `Bearer ${adminToken}` } })).json()) as { tenants: { id: string; plan: string }[] };
  check("fleet lists both tenants", fleet.tenants.length === 2);
  await fetch(`${BASE}/admin/tenants/${tenant}`, {
    method: "PUT", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ plan: "growth" }),
  });
  await new Promise((r) => setTimeout(r, 600));
  const { rows: kvPlan } = await db.query(
    "select value->>'plan' as p from kv_state where kind='platform' and store_id=$1", [tenant]);
  check("admin plan override mirrored to tenant", kvPlan[0]?.p === "growth");

  const imp = (await (await fetch(`${BASE}/admin/tenants/${tenant}/impersonate`, {
    method: "POST", headers: { authorization: `Bearer ${adminToken}` } })).json()) as { token: string };
  check("impersonation token issued", imp.token.startsWith("sc_imp_"));
  const impStatus = (await (await fetch(`${BASE}/auth/status`, {
    headers: { authorization: `Bearer ${imp.token}` } })).json()) as { tenant?: { impersonated?: boolean } };
  check("impersonation flagged for the banner", impStatus.tenant?.impersonated === true);
  const { rows: auditRows } = await db.query("select action from audit_log where store_id = $1 order by id", [tenant]);
  check("audit log records override + impersonation",
    auditRows.some((r) => r.action === "tenant_override") && auditRows.some((r) => r.action === "impersonate"),
    auditRows.map((r) => r.action).join(","));

  await fetch(`${BASE}/admin/tenants/${tenant}`, {
    method: "PUT", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ status: "locked" }),
  });
  await new Promise((r) => setTimeout(r, 600));
  const lockedChat = await fetch(`${BASE}/agents/pricing/chat`, {
    method: "POST",
    headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
    body: JSON.stringify({ message: "x" }),
  });
  check("locked tenant's merchant gets 402", lockedChat.status === 402, String(lockedChat.status));

  // ---------- retention purge ----------
  await webhook("app.uninstalled", 777, {});
  await db.query("update stores set uninstalled_at = now() - interval '91 days' where id = $1", [tenant]);
  const { initStorage, closeStorage } = await import("../src/store/jsonStore.js");
  await initStorage();
  const { purgeExpiredRetention } = await import("../src/tenancy/registry.js");
  const purged = await purgeExpiredRetention(90);
  check("90-day retention purge removes the tenant", purged === 1);
  const { rows: gone } = await db.query("select 1 from stores where id = $1", [tenant]);
  const { rows: kvGone } = await db.query("select 1 from kv_state where store_id = $1", [tenant]);
  check("cascade wiped all tenant data", gone.length === 0 && kvGone.length === 0);
  await closeStorage();
} finally {
  server.kill("SIGTERM");
  sallaMock.close();
  llmMock.close();
  await db.end();
  fs.rmSync("/tmp/acct-empty", { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAccounts & fleet all green ✅" : `\n${failures} failed ❌`);
process.exit(failures === 0 ? 0 : 1);
