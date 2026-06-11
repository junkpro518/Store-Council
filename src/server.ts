import express from "express";
import cron from "node-cron";
import crypto from "node:crypto";
import { config } from "./config.js";
import { ALL_AGENTS, getAgent } from "./agents/definitions.js";
import { runAgent } from "./agents/runner.js";
import { authorizeUrl, exchangeCode, isConnected } from "./salla/auth.js";
import { runDailyAnalysis, listReports, getReport } from "./pipeline/daily.js";
import { getHistory, appendExchange, clearHistory } from "./chat/chatStore.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- Health & store connection ----------

app.get("/health", (_req, res) => {
  res.json({ ok: true, storeConnected: isConnected() });
});

const pendingStates = new Set<string>();

app.get("/auth/salla", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  res.redirect(authorizeUrl(state));
});

app.get("/auth/salla/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !pendingStates.delete(state)) {
    res.status(400).json({ error: "Invalid OAuth callback" });
    return;
  }
  try {
    await exchangeCode(code);
    res.json({ ok: true, message: "Store connected. The council can now see your store (read-only)." });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- Agents ----------

app.get("/agents", (_req, res) => {
  res.json(
    ALL_AGENTS.map(({ id, name, nameAr, title, expertise }) => ({
      id,
      name,
      nameAr,
      title,
      expertise,
    }))
  );
});

/** Chat directly with one manager. Body: { message: string } */
app.post("/agents/:id/chat", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: `No agent "${req.params.id}"` });
    return;
  }
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    res.status(400).json({ error: "Body must include { message }" });
    return;
  }
  if (!isConnected()) {
    res.status(409).json({ error: "Store not connected. Visit /auth/salla first." });
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

app.get("/agents/:id/chat", (req, res) => {
  res.json({ agent: req.params.id, history: getHistory(req.params.id) });
});

app.delete("/agents/:id/chat", (req, res) => {
  clearHistory(req.params.id);
  res.json({ ok: true });
});

// ---------- Daily reports ----------

app.get("/reports", (_req, res) => {
  res.json(listReports().map(({ date, startedAt, finishedAt }) => ({ date, startedAt, finishedAt })));
});

app.get("/reports/:date", (req, res) => {
  const report = getReport(req.params.date);
  if (!report) {
    res.status(404).json({ error: "No report for that date" });
    return;
  }
  res.json(report);
});

/** Trigger today's analysis on demand (also runs on the cron schedule). */
app.post("/reports/run", async (_req, res) => {
  if (!isConnected()) {
    res.status(409).json({ error: "Store not connected. Visit /auth/salla first." });
    return;
  }
  try {
    const report = await runDailyAnalysis();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- Scheduler ----------

cron.schedule(config.dailyCron, async () => {
  if (!isConnected()) return;
  console.log("[scheduler] starting daily council analysis...");
  try {
    const report = await runDailyAnalysis();
    console.log(`[scheduler] daily report ${report.date} done.`);
  } catch (err) {
    console.error("[scheduler] daily analysis failed:", err);
  }
});

app.listen(config.port, () => {
  console.log(`Store Council listening on :${config.port}`);
  console.log(`Connect a store: http://localhost:${config.port}/auth/salla`);
  console.log(`Daily analysis cron: "${config.dailyCron}"`);
});
