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

const app = express();
app.use(express.json({ limit: "1mb" }));

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
  if (owner.verifyToken(bearer(req))) {
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

app.post("/auth/login", (req, res) => {
  const token = owner.login(String(req.body?.password ?? ""));
  if (!token) {
    res.status(401).json({ error: "Wrong password" });
    return;
  }
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

app.post("/salla/disconnect", requireAuth, (_req, res) => {
  disconnectStore();
  res.json({ ok: true });
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
  const { enabled, displayName, customInstructions, focus } = req.body ?? {};
  setAgentOverride(agent.id, {
    ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
    ...(displayName !== undefined ? { displayName: String(displayName) } : {}),
    ...(customInstructions !== undefined
      ? { customInstructions: String(customInstructions) }
      : {}),
    ...(focus !== undefined
      ? { focus: Array.isArray(focus) ? focus.map(String).filter(Boolean) : [] }
      : {}),
  });
  res.json({ ok: true, agent: effectiveAgent(agent.id) });
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

app.listen(config.port, () => {
  console.log(`Store Council dashboard: http://localhost:${config.port}`);
});
