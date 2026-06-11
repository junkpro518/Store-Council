import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AgentDef } from "./definitions.js";
import { sallaGet, sallaGetAll } from "../salla/client.js";

const MAX_CONSULT_DEPTH = 2;

/** Truncate huge API payloads before they enter the model context. */
function clip(value: unknown, maxChars = 24_000): string {
  const text = JSON.stringify(value, null, 1);
  return text.length > maxChars
    ? text.slice(0, maxChars) + `\n...[truncated ${text.length - maxChars} chars — narrow your query with filters or per-page params]`
    : text;
}

/**
 * Builds the tool set for one agent.
 * `runAgent` is injected to avoid a circular import with runner.ts.
 */
export function buildTools(
  agent: AgentDef,
  runAgent: (agentId: string, question: string, depth: number) => Promise<string>,
  depth: number
) {
  const sallaRead = betaZodTool({
    name: "salla_read",
    description: `Read data from the merchant's Salla store (READ-ONLY). Endpoints available to you as ${agent.name}: ${agent.endpoints.join(", ")}. Call this whenever you need facts about the store — never answer from assumption when the data is one call away. Supports query params like page, per_page, status, from_date, to_date, keyword.`,
    inputSchema: z.object({
      endpoint: z
        .string()
        .describe(`One of your allowed endpoints, e.g. "${agent.endpoints[0]}". For {id} endpoints substitute the real id, e.g. "products/12345".`),
      params: z
        .record(z.union([z.string(), z.number()]))
        .optional()
        .describe("Optional query params (page, per_page, status, from_date YYYY-MM-DD, to_date, keyword...)"),
      all_pages: z
        .boolean()
        .optional()
        .describe("Set true to fetch up to 10 pages of a list endpoint (for counting/aggregation)."),
    }),
    run: async ({ endpoint, params, all_pages }) => {
      const base = endpoint.replace(/^\/+/, "").split("?")[0];
      const root = base.replace(/\/[A-Za-z0-9_-]+$/, "/{id}");
      const allowed =
        agent.endpoints.includes(base) || agent.endpoints.includes(root);
      if (!allowed) {
        return `Endpoint "${base}" is outside your department's data access (${agent.endpoints.join(", ")}). If you need it, consult the manager who owns that data via consult_agent.`;
      }
      try {
        const data = all_pages
          ? await sallaGetAll(base, params ?? {})
          : await sallaGet(base, params ?? {});
        return clip(data);
      } catch (err) {
        return `Error reading Salla API: ${(err as Error).message}`;
      }
    },
  });

  const consultAgent = betaZodTool({
    name: "consult_agent",
    description:
      "Ask another department manager on the Store Council a question. Call this when a finding crosses into a colleague's domain (e.g. you found a pricing issue but shipping data would confirm the cause). Phrase a specific, answerable question and include the relevant numbers you already found.",
    inputSchema: z.object({
      agent_id: z.string().describe("The colleague's id, e.g. 'pricing', 'shipping', 'finance'."),
      question: z.string().describe("A specific question, with the context/numbers they need to answer it."),
    }),
    run: async ({ agent_id, question }) => {
      if (agent_id === agent.id) return "You cannot consult yourself.";
      if (depth >= MAX_CONSULT_DEPTH) {
        return "Consultation depth limit reached — answer with the data you already have.";
      }
      try {
        return await runAgent(agent_id, question, depth + 1);
      } catch (err) {
        return `Consultation failed: ${(err as Error).message}`;
      }
    },
  });

  const calculate = betaZodTool({
    name: "calculate",
    description:
      "Evaluate a basic arithmetic expression (numbers, + - * / % ( ) .) for exact metrics like AOV, rates, and percentage changes. Use this instead of doing arithmetic in your head when precision matters.",
    inputSchema: z.object({
      expression: z.string().describe("e.g. '(45200 / 312)' or '(89 - 64) / 64 * 100'"),
    }),
    run: async ({ expression }) => {
      if (!/^[\d\s+\-*/%().]+$/.test(expression)) {
        return "Invalid expression: only numbers and + - * / % ( ) are allowed.";
      }
      try {
        const result = new Function(`"use strict"; return (${expression});`)();
        return String(result);
      } catch {
        return "Could not evaluate expression.";
      }
    },
  });

  return [sallaRead, consultAgent, calculate];
}
