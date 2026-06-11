import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { effectiveAgents, effectiveAgent } from "../agents/definitions.js";
import { runAgent } from "../agents/runner.js";
import {
  listReports,
  getReport,
  setActionStatus,
  achievements,
} from "../pipeline/daily.js";
import { metricsHistory } from "../pipeline/metrics.js";

/**
 * MCP server exposing the Store Council to external AI clients
 * (Claude, ChatGPT, or any MCP-capable tool). Strategy Pillar C: merchants
 * who live inside a general AI chat talk to THEIR OWN council from there —
 * with its memory, specialists, playbooks, and daily reports behind it.
 *
 * Everything here is read-only against the store; the only mutation is
 * action-status tracking, which touches platform data, never the store.
 */

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });

export function buildCouncilMcpServer(): McpServer {
  const server = new McpServer({ name: "store-council", version: "1.0.0" });

  server.tool(
    "list_managers",
    "List the Store Council's AI department managers (id, name, role, enabled). Use the id with ask_manager.",
    {},
    async () =>
      textResult(
        JSON.stringify(
          effectiveAgents().map(({ id, name, nameAr, title, enabled }) => ({
            id,
            name,
            nameAr,
            title,
            enabled,
          })),
          null,
          1
        )
      )
  );

  server.tool(
    "ask_manager",
    "Ask one of the store's AI department managers a question. The manager reads live store data, applies its accumulated memory of this store, and may consult colleague managers before answering. Manager ids: gm (general manager), catalog, pricing, marketing, seo, cro, customer-service, retention, orders, shipping, inventory, finance, reviews, payments, growth.",
    {
      manager_id: z.string().describe("The manager's id, e.g. 'pricing'."),
      question: z.string().describe("The question, in Arabic or English."),
    },
    async ({ manager_id, question }) => {
      const agent = effectiveAgent(manager_id);
      if (!agent) return textResult(`No manager "${manager_id}". Use list_managers.`);
      if (!agent.enabled) return textResult(`${agent.name} is disabled by the store owner.`);
      return textResult(await runAgent(manager_id, question));
    }
  );

  server.tool(
    "get_daily_report",
    "Get the council's daily store report: executive summary, ranked action items (with implementation steps), and per-department findings. Omit date for the latest report.",
    { date: z.string().optional().describe("YYYY-MM-DD; omit for latest.") },
    async ({ date }) => {
      const report = date ? getReport(date) : listReports()[0] && getReport(listReports()[0].date);
      if (!report) return textResult("No reports yet — the daily analysis hasn't run.");
      return textResult(
        JSON.stringify(
          {
            date: report.date,
            summary: report.summary,
            actions: report.actions,
          },
          null,
          1
        )
      );
    }
  );

  server.tool(
    "list_reports",
    "List available daily report dates with action counts.",
    {},
    async () => textResult(JSON.stringify(listReports(), null, 1))
  );

  server.tool(
    "set_action_status",
    "Mark an action item from a daily report as done, dismissed, or new (re-open). This drives the council's learning: dismissed advice isn't repeated; done actions get their impact measured after ~2 weeks.",
    {
      date: z.string().describe("Report date YYYY-MM-DD."),
      index: z.number().int().describe("Action index within the report (0-based)."),
      status: z.enum(["new", "done", "dismissed"]),
    },
    async ({ date, index, status }) => {
      const updated = setActionStatus(date, index, status);
      if (!updated) return textResult("Report or action not found.");
      return textResult(`Action #${index} in ${date} marked "${status}".`);
    }
  );

  server.tool(
    "get_achievements",
    "The achievement ledger: every recommendation the owner implemented, with measured real-world impact (filled ~14 days after implementation).",
    {},
    async () => {
      const items = achievements();
      if (items.length === 0) return textResult("No implemented actions yet.");
      return textResult(JSON.stringify(items, null, 1));
    }
  );

  server.tool(
    "get_metrics_history",
    "The store's daily KPI time series captured by the platform (orders, customers, products, abandoned carts).",
    { days: z.number().int().optional().describe("Days back (default 30, max 365).") },
    async ({ days }) => {
      const series = metricsHistory(Math.min(Math.max(days ?? 30, 1), 365));
      return textResult(series.length ? JSON.stringify(series) : "No metrics history yet.");
    }
  );

  return server;
}
