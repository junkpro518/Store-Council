import express from "express";
import cron, { ScheduledTask } from "node-cron";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  effectiveAgents,
  effectiveAgent,
  getAgent,
} from "./agents/definitions.js";
import { runAgent } from "./agents/runner.js";
import {
  authorizeUrl,
  exchangeCode,
  isConnected,
  disconnectStore,
} from "./salla/auth.js";
import {
  runDailyAnalysis,
  listReports,
  getReport,
  setActionStatus,
  ActionStatus,
} from "./pipeline/daily.js";
import { getHistory, appendExchange, clearHistory } from "./chat/chatStore.js";
import {
  getSettings,
  updateSettings,
  setAgentOverride,
  anthropicKey,
} from "./settings/settings.js";
import * as owner from "./auth/owner.js";
import { verifySignature, handleWebhook, recentEvents } from "./salla/webhooks.js";
import { getStoreInfo } from "./salla/storeInfo.js";
import { connectionInfo } from "./salla/auth.js";
import { llm, testOpenRouter } from "./llm/client.js";
import { memories, forget } from "./agents/memory.js";
import { curatorStatus, runCurator } from "./pipeline/curator.js";
import { listDocs, addDoc, updateDoc, deleteDoc } from "./agents/knowledge.js";
import { listQuestions, answerQuestion, dismissQuestion, QuestionStatus } from "./agents/questions.js";
import * as admin from "./admin/adminAuth.js";
import { platformState, updatePlatform, tenantLocked } from "./admin/platform.js";
import { recentEvents as recentWebhookEvents } from "./salla/webhooks.js";
import { achievements } from "./pipeline/daily.js";
import { listChanges, approveChange, rejectChange, ChangeStatus } from "./changes/changes.js";
import { buildCouncilMcpServer } from "./mcp/council.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { aiConfigured } from "./settings/settings.js";
import { sallaGet } from "./salla/client.js";

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.path.startsWith("/admin")) {
    // The central panel is never embeddable.
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  } else {
    // The merchant dashboard may be embedded inside the Salla dashboard only.
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self' https://*.salla.sa https://salla.sa https://*.salla.group"
    );
  }
  next();
});
app.use(
  express.json({
    limit: "1mb",
    // Keep the raw body so Salla webhook signatures can be verified.
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public"
);
app.use(express.static(publicDir));

// ---------- Auth middleware ----------

function bearer(req: express.Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return typeof req.query.token === "string" ? req.query.token : undefined;
}

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!owner.verifyToken(bearer(req))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Central-panel lock gate: a locked tenant can log in and read the lock
  // message, but every merchant operation is suspended until unlocked.
  if (tenantLocked()) {
    res.status(402).json({
      error:
        "تم إيقاف الخدمة مؤقتاً من إدارة المنصة (اشتراك غير مفعّل). تواصل مع الدعم. / Service suspended by the platform administrator (inactive subscription). Contact support.",
      locked: true,
    });
    return;
  }
  next();
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (admin.adminVerify(bearer(req))) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

// ---------- Public: health & owner auth ----------

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/auth/status", (req, res) => {
  res.json({
    setup: owner.isSetup(),
    authenticated: owner.verifyToken(bearer(req)),
    storeConnected: isConnected(),
    provider: getSettings().provider,
    aiConfigured: aiConfigured(),
    // kept for backward compatibility with older dashboards
    anthropicConfigured: Boolean(anthropicKey()),
  });
});

app.post("/auth/setup", (req, res) => {
  try {
    const token = owner.setupOwner(String(req.body?.password ?? ""));
    res.json({ token });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Brute-force protection: lock login for 10 minutes after 5 failures per IP.
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

app.post("/auth/login", (req, res) => {
  const ip = req.ip ?? "unknown";
  const entry = loginFailures.get(ip);
  if (entry && entry.lockedUntil > Date.now()) {
    res.status(429).json({
      error: "Too many failed attempts. Try again in a few minutes.",
    });
    return;
  }
  const token = owner.login(String(req.body?.password ?? ""));
  if (!token) {
    const count = (entry?.count ?? 0) + 1;
    loginFailures.set(ip, {
      count,
      lockedUntil: count >= 5 ? Date.now() + 10 * 60 * 1000 : 0,
    });
    res.status(401).json({ error: "Wrong password" });
    return;
  }
  loginFailures.delete(ip);
  res.json({ token });
});

app.post("/auth/logout", requireAuth, (req, res) => {
  owner.logout(bearer(req)!);
  res.json({ ok: true });
});

app.post("/auth/change-password", requireAuth, (req, res) => {
  try {
    owner.changePassword(
      String(req.body?.current ?? ""),
      String(req.body?.next ?? "")
    );
    res.json({ ok: true, message: "Password changed. Please log in again." });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------- Salla store connection ----------

const pendingStates = new Set<string>();

app.get("/auth/salla", (req, res) => {
  // Initiated from the dashboard with ?token= since it's a browser navigation.
  if (!owner.verifyToken(bearer(req))) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    const state = crypto.randomBytes(16).toString("hex");
    pendingStates.add(state);
    res.redirect(authorizeUrl(state));
  } catch (err) {
    res.status(400).send((err as Error).message);
  }
});

app.get("/auth/salla/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !pendingStates.delete(state)) {
    res.status(400).send("Invalid OAuth callback");
    return;
  }
  try {
    await exchangeCode(code);
    res.redirect("/#/settings?connected=1");
  } catch (err) {
    res.status(500).send((err as Error).message);
  }
});

// ---------- Salla-dashboard embedding (auto-login inside the iframe) ----------

app.get("/embed", (req, res) => {
  const token = owner.sessionFromEmbedKey(String(req.query.k ?? ""));
  if (!token) {
    res.status(401).send("Invalid embed key. Generate a fresh embed link from Settings.");
    return;
  }
  // Store the session in the browser, then enter the dashboard.
  res
    .type("html")
    .send(
      `<!doctype html><meta charset="utf-8"><script>localStorage.setItem("sc_token",${JSON.stringify(token)});location.replace("/");</script>`
    );
});

app.get("/auth/embed-link", requireAuth, (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({ url: `${origin}/embed?k=${owner.embedKey()}` });
});

app.post("/auth/embed-link/rotate", requireAuth, (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({ url: `${origin}/embed?k=${owner.rotateEmbedKey()}` });
});

app.post("/salla/disconnect", requireAuth, (_req, res) => {
  disconnectStore();
  res.json({ ok: true });
});

// ---------- Salla webhooks (required for App Store listing) ----------

app.post("/webhooks/salla", (req, res) => {
  const raw = (req as express.Request & { rawBody?: Buffer }).rawBody;
  const signature = req.header("x-salla-signature");
  if (!raw || !verifySignature(raw, signature)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }
  try {
    const action = handleWebhook(req.body ?? {});
    console.log(`[webhook] ${req.body?.event}: ${action}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[webhook] handler error:", err);
    res.status(500).json({ error: "Webhook handling failed" });
  }
});

// ---------- Store identity & events ----------

app.get("/store/summary", requireAuth, async (req, res) => {
  const connected = isConnected();
  const info = connected
    ? await getStoreInfo(req.query.refresh === "1")
    : null;
  res.json({
    connected,
    ...connectionInfo(),
    name: info?.name ?? "",
    domain: info?.domain ?? "",
    plan: info?.plan ?? "",
  });
});

app.get("/store/events", requireAuth, (_req, res) => {
  res.json(recentEvents());
});

// ---------- Diagnostics (owner-facing health checks) ----------

app.get("/diagnostics", requireAuth, async (_req, res) => {
  const settings = getSettings();
  const result = {
    provider: settings.provider,
    ai: { ok: false, detail: "" },
    salla: { ok: false, detail: "" },
    webhookSecret: Boolean(settings.salla.webhookSecret),
    dailyEnabled: settings.dailyEnabled,
  };
  try {
    if (settings.provider === "openrouter") {
      result.ai = { ok: true, detail: await testOpenRouter() };
    } else {
      await llm().models.list({ limit: 1 });
      result.ai = { ok: true, detail: "API key valid" };
    }
  } catch (err) {
    result.ai = { ok: false, detail: (err as Error).message };
  }
  try {
    if (!isConnected()) throw new Error("Store not connected");
    const info = (await sallaGet("store/info")) as { data?: { name?: string } };
    result.salla = { ok: true, detail: info.data?.name ?? "Connected" };
  } catch (err) {
    result.salla = { ok: false, detail: (err as Error).message };
  }
  res.json(result);
});

// ---------- Settings ----------

app.get("/settings", requireAuth, (_req, res) => {
  res.json(getSettings());
});

app.put("/settings", requireAuth, (req, res) => {
  try {
    const patch = req.body ?? {};
    if (patch.dailyCron !== undefined && !cron.validate(String(patch.dailyCron))) {
      res.status(400).json({ error: "Invalid cron expression" });
      return;
    }
    const next = updateSettings(patch);
    applySchedule();
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------- Agents ----------

app.get("/agents", requireAuth, (_req, res) => {
  res.json(
    effectiveAgents().map((a) => ({
      id: a.id,
      name: a.name,
      defaultName: getAgent(a.id)!.name,
      nameAr: a.nameAr,
      title: a.title,
      expertise: a.expertise,
      focus: a.focus,
      defaultFocus: getAgent(a.id)!.focus,
      endpoints: a.endpoints,
      enabled: a.enabled,
      customInstructions: a.customInstructions,
      writeMode: a.writeMode,
      writeModeOverride: getSettings().agents[a.id]?.writeMode ?? "inherit",
      isOrchestrator: a.id === "gm",
    }))
  );
});

app.put("/agents/:id/config", requireAuth, (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: `No agent "${req.params.id}"` });
    return;
  }
  const { enabled, displayName, customInstructions, focus, writeMode } = req.body ?? {};
  if (
    writeMode !== undefined &&
    !["inherit", "read_only", "confirm", "auto"].includes(String(writeMode))
  ) {
    res.status(400).json({ error: "writeMode must be inherit | read_only | confirm | auto" });
    return;
  }
  setAgentOverride(agent.id, {
    ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
    ...(displayName !== undefined ? { displayName: String(displayName) } : {}),
    ...(customInstructions !== undefined
      ? { customInstructions: String(customInstructions) }
      : {}),
    ...(focus !== undefined
      ? { focus: Array.isArray(focus) ? focus.map(String).filter(Boolean) : [] }
      : {}),
    ...(writeMode !== undefined
      ? { writeMode: writeMode as "inherit" | "read_only" | "confirm" | "auto" }
      : {}),
  });
  res.json({ ok: true, agent: effectiveAgent(agent.id) });
});

// ---------- Agent memory (the learning system, owner-manageable) ----------

app.get("/agents/:id/memory", requireAuth, (req, res) => {
  if (!getAgent(req.params.id)) {
    res.status(404).json({ error: `No agent "${req.params.id}"` });
    return;
  }
  res.json(memories(req.params.id));
});

app.delete("/agents/:id/memory/:memoryId", requireAuth, (req, res) => {
  const removed = forget(req.params.id, req.params.memoryId);
  if (!removed) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }
  res.json({ ok: true });
});

// ---------- Change requests (write-mode approval queue + journal) ----------

app.get("/changes", requireAuth, (req, res) => {
  const status = req.query.status as ChangeStatus | undefined;
  if (status && !["pending", "applied", "rejected", "failed"].includes(status)) {
    res.status(400).json({ error: "Invalid status filter" });
    return;
  }
  res.json(listChanges(status));
});

app.post("/changes/:id/approve", requireAuth, async (req, res) => {
  const result = await approveChange(req.params.id);
  if (!result) {
    res.status(404).json({ error: "No pending change with that id" });
    return;
  }
  res.json(result);
});

app.post("/changes/:id/reject", requireAuth, (req, res) => {
  const result = rejectChange(req.params.id, String(req.body?.reason ?? ""));
  if (!result) {
    res.status(404).json({ error: "No pending change with that id" });
    return;
  }
  res.json(result);
});

// ---------- Achievement ledger ----------

app.get("/achievements", requireAuth, (_req, res) => {
  res.json(achievements());
});

// ---------- MCP server (talk to the council from Claude/ChatGPT) ----------

app.post("/mcp", requireAuth, async (req, res) => {
  try {
    // Stateless mode: a fresh server+transport per request.
    const mcp = buildCouncilMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] request failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Use POST (stateless MCP transport)" });
});

app.get("/integration-token", requireAuth, (_req, res) => {
  res.json({ token: owner.integrationToken(), mcpUrl: "/mcp" });
});

app.post("/integration-token/rotate", requireAuth, (_req, res) => {
  res.json({ token: owner.rotateIntegrationToken() });
});

app.get("/curator/status", requireAuth, (_req, res) => {
  res.json(curatorStatus());
});

app.post("/curator/run", requireAuth, async (_req, res) => {
  try {
    res.json({ ok: true, summary: await runCurator() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- Knowledge base (owner-provided documents per agent) ----------

function validKnowledgeOwner(id: string): boolean {
  return id === "all" || Boolean(getAgent(id));
}

app.get("/agents/:id/knowledge", requireAuth, (req, res) => {
  if (!validKnowledgeOwner(req.params.id)) {
    res.status(404).json({ error: `No agent "${req.params.id}"` });
    return;
  }
  res.json(listDocs(req.params.id));
});

app.post("/agents/:id/knowledge", requireAuth, (req, res) => {
  if (!validKnowledgeOwner(req.params.id)) {
    res.status(404).json({ error: `No agent "${req.params.id}"` });
    return;
  }
  try {
    res.json(addDoc(req.params.id, String(req.body?.title ?? ""), String(req.body?.content ?? "")));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put("/agents/:id/knowledge/:docId", requireAuth, (req, res) => {
  const updated = updateDoc(req.params.id, req.params.docId, {
    ...(req.body?.title !== undefined ? { title: String(req.body.title) } : {}),
    ...(req.body?.content !== undefined ? { content: String(req.body.content) } : {}),
  });
  if (!updated) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(updated);
});

app.delete("/agents/:id/knowledge/:docId", requireAuth, (req, res) => {
  if (!deleteDoc(req.params.id, req.params.docId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ ok: true });
});

// ---------- Owner questions (the managers' discussion inbox) ----------

app.get("/questions", requireAuth, (req, res) => {
  const status = req.query.status as QuestionStatus | undefined;
  if (status && !["pending", "answered", "dismissed"].includes(status)) {
    res.status(400).json({ error: "Invalid status filter" });
    return;
  }
  res.json(listQuestions(status));
});

app.post("/questions/:id/answer", requireAuth, (req, res) => {
  const answer = String(req.body?.answer ?? "").trim();
  if (!answer) {
    res.status(400).json({ error: "Body must include { answer }" });
    return;
  }
  const updated = answerQuestion(req.params.id, answer);
  if (!updated) {
    res.status(404).json({ error: "No pending question with that id" });
    return;
  }
  res.json(updated);
});

app.post("/questions/:id/dismiss", requireAuth, (req, res) => {
  if (!dismissQuestion(req.params.id)) {
    res.status(404).json({ error: "No pending question with that id" });
    return;
  }
  res.json({ ok: true });
});

// ---------- Central panel (platform owner) — /admin/* ----------

app.get("/admin/auth/status", (req, res) => {
  res.json({ setup: admin.adminIsSetup(), authenticated: admin.adminVerify(bearer(req)) });
});

app.post("/admin/auth/setup", (req, res) => {
  try {
    res.json({ token: admin.adminSetup(String(req.body?.password ?? "")) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const adminLoginFailures = new Map<string, { count: number; lockedUntil: number }>();

app.post("/admin/auth/login", (req, res) => {
  const ip = req.ip ?? "unknown";
  const entry = adminLoginFailures.get(ip);
  if (entry && entry.lockedUntil > Date.now()) {
    res.status(429).json({ error: "Too many failed attempts." });
    return;
  }
  const token = admin.adminLogin(String(req.body?.password ?? ""));
  if (!token) {
    const count = (entry?.count ?? 0) + 1;
    adminLoginFailures.set(ip, { count, lockedUntil: count >= 5 ? Date.now() + 10 * 60 * 1000 : 0 });
    res.status(401).json({ error: "Wrong password" });
    return;
  }
  adminLoginFailures.delete(ip);
  res.json({ token });
});

app.post("/admin/auth/logout", requireAdmin, (req, res) => {
  admin.adminLogout(bearer(req)!);
  res.json({ ok: true });
});

app.get("/admin/overview", requireAdmin, async (_req, res) => {
  const reports = listReports();
  const allActions = reports.flatMap((r) => getReport(r.date)?.actions ?? []);
  const info = isConnected() ? await getStoreInfo() : null;
  res.json({
    platform: platformState(),
    store: {
      connected: isConnected(),
      ...connectionInfo(),
      name: info?.name ?? "",
      domain: info?.domain ?? "",
    },
    merchantSetup: owner.isSetup(),
    aiConfigured: aiConfigured(),
    provider: getSettings().provider,
    counts: {
      reports: reports.length,
      actions: allActions.length,
      actionsDone: allActions.filter((a) => a.status === "done").length,
      pendingChanges: listChanges("pending").length,
      pendingQuestions: listQuestions("pending").length,
      recentEvents: recentWebhookEvents(5).length,
    },
    agents: effectiveAgents().map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      writeMode: a.writeMode,
      memories: memories(a.id).length,
    })),
    curator: curatorStatus(),
    analysisRunning,
  });
});

app.put("/admin/platform", requireAdmin, (req, res) => {
  const { plan, status, notes } = req.body ?? {};
  if (plan !== undefined && !["trial", "basic", "pro", "growth", "custom"].includes(String(plan))) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }
  if (status !== undefined && !["active", "locked"].includes(String(status))) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  res.json(updatePlatform({ plan, status, notes }));
});

app.post("/admin/curator/run", requireAdmin, async (_req, res) => {
  try {
    res.json({ ok: true, summary: await runCurator() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- Chat ----------

app.post("/agents/:id/chat", requireAuth, async (req, res) => {
  const agent = effectiveAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: `No agent "${req.params.id}"` });
    return;
  }
  if (!agent.enabled) {
    res.status(409).json({ error: `${agent.name} is disabled. Enable it from the Managers page.` });
    return;
  }
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "Body must include { message }" });
    return;
  }
  if (!isConnected()) {
    res.status(409).json({ error: "Store not connected. Connect it from Settings." });
    return;
  }
  try {
    const history = getHistory(agent.id);
    const reply = await runAgent(agent.id, message, 0, history);
    appendExchange(agent.id, message, reply);
    res.json({ agent: agent.id, reply });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/agents/:id/chat", requireAuth, (req, res) => {
  res.json({ agent: req.params.id, history: getHistory(req.params.id) });
});

app.delete("/agents/:id/chat", requireAuth, (req, res) => {
  clearHistory(req.params.id);
  res.json({ ok: true });
});

// ---------- Daily reports ----------

let analysisRunning = false;

app.get("/reports", requireAuth, (_req, res) => {
  res.json(
    listReports().map(({ date, startedAt, finishedAt, actions }) => ({
      date,
      startedAt,
      finishedAt,
      actionCount: actions.length,
      doneCount: actions.filter((a) => a.status === "done").length,
    }))
  );
});

app.get("/reports/latest", requireAuth, (_req, res) => {
  const [latest] = listReports();
  if (!latest) {
    res.status(404).json({ error: "No reports yet" });
    return;
  }
  res.json(latest);
});

app.get("/reports/status", requireAuth, (_req, res) => {
  res.json({ running: analysisRunning });
});

app.get("/reports/:date", requireAuth, (req, res) => {
  const report = getReport(req.params.date);
  if (!report) {
    res.status(404).json({ error: "No report for that date" });
    return;
  }
  res.json(report);
});

app.post("/reports/:date/actions/:index", requireAuth, (req, res) => {
  const status = String(req.body?.status ?? "") as ActionStatus;
  if (!["new", "done", "dismissed"].includes(status)) {
    res.status(400).json({ error: "status must be new | done | dismissed" });
    return;
  }
  const report = setActionStatus(req.params.date, Number(req.params.index), status);
  if (!report) {
    res.status(404).json({ error: "Report or action not found" });
    return;
  }
  res.json(report);
});

app.post("/reports/run", requireAuth, async (_req, res) => {
  if (!isConnected()) {
    res.status(409).json({ error: "Store not connected. Connect it from Settings." });
    return;
  }
  if (analysisRunning) {
    res.status(409).json({ error: "An analysis is already running." });
    return;
  }
  analysisRunning = true;
  // Long-running: respond immediately; the dashboard polls /reports/status.
  res.json({ ok: true, message: "Analysis started" });
  try {
    await runDailyAnalysis();
  } catch (err) {
    console.error("Manual analysis failed:", err);
  } finally {
    analysisRunning = false;
  }
});

// ---------- Scheduler ----------

let task: ScheduledTask | null = null;

function applySchedule(): void {
  task?.stop();
  task = null;
  const settings = getSettings();
  if (!settings.dailyEnabled) {
    console.log("[scheduler] daily analysis disabled");
    return;
  }
  if (!cron.validate(settings.dailyCron)) {
    console.error(`[scheduler] invalid cron "${settings.dailyCron}" — scheduler off`);
    return;
  }
  task = cron.schedule(
    settings.dailyCron,
    async () => {
      if (!isConnected() || analysisRunning) return;
      analysisRunning = true;
      console.log("[scheduler] starting daily council analysis...");
      try {
        const report = await runDailyAnalysis();
        console.log(`[scheduler] daily report ${report.date} done.`);
      } catch (err) {
        console.error("[scheduler] daily analysis failed:", err);
      } finally {
        analysisRunning = false;
      }
    },
    { timezone: settings.timezone || undefined }
  );
  console.log(
    `[scheduler] daily analysis at "${settings.dailyCron}" (${settings.timezone})`
  );
}

applySchedule();

// Malformed JSON bodies and other route errors return JSON, never an HTML page.
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = "status" in err && typeof err.status === "number" ? err.status : 500;
    res.status(status).json({ error: status === 500 ? "Internal error" : err.message });
  }
);

const server = app.listen(config.port, () => {
  console.log(`Store Council dashboard: http://localhost:${config.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received — shutting down`);
    task?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
