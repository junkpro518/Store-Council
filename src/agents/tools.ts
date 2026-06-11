import { EffectiveAgent, effectiveAgent } from "./definitions.js";
import { sallaGet, sallaGetAll } from "../salla/client.js";

const MAX_CONSULT_DEPTH = 2;

/**
 * Provider-neutral tool definition: a JSON-Schema signature plus an
 * implementation. The runner adapts these to the Anthropic Messages API
 * (input_schema) or OpenRouter chat-completions (function calling).
 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  run: (input: Record<string, unknown>) => Promise<string>;
}

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
  agent: EffectiveAgent,
  runAgent: (agentId: string, question: string, depth: number) => Promise<string>,
  depth: number
): ToolDef[] {
  const sallaRead: ToolDef = {
    name: "salla_read",
    description: `Read data from the merchant's Salla store (READ-ONLY). Endpoints available to you as ${agent.name}: ${agent.endpoints.join(", ")}. Call this whenever you need facts about the store — never answer from assumption when the data is one call away. Supports query params like page, per_page, status, from_date, to_date, keyword.`,
    parameters: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: `One of your allowed endpoints, e.g. "${agent.endpoints[0]}". For {id} endpoints substitute the real id, e.g. "products/12345".`,
        },
        params: {
          type: "object",
          description:
            "Optional query params (page, per_page, status, from_date YYYY-MM-DD, to_date, keyword...)",
          additionalProperties: true,
        },
        all_pages: {
          type: "boolean",
          description:
            "Set true to fetch up to 10 pages of a list endpoint (for counting/aggregation).",
        },
      },
      required: ["endpoint"],
    },
    run: async (input) => {
      const endpoint = String(input.endpoint ?? "");
      const params = (input.params ?? {}) as Record<string, string | number>;
      const base = endpoint.replace(/^\/+/, "").split("?")[0];
      const root = base.replace(/\/[A-Za-z0-9_-]+$/, "/{id}");
      const allowed =
        agent.endpoints.includes(base) || agent.endpoints.includes(root);
      if (!allowed) {
        return `Endpoint "${base}" is outside your department's data access (${agent.endpoints.join(", ")}). If you need it, consult the manager who owns that data via consult_agent.`;
      }
      try {
        const data = input.all_pages
          ? await sallaGetAll(base, params)
          : await sallaGet(base, params);
        return clip(data);
      } catch (err) {
        return `Error reading Salla API: ${(err as Error).message}`;
      }
    },
  };

  const consultAgent: ToolDef = {
    name: "consult_agent",
    description:
      "Ask another department manager on the Store Council a question. Call this when a finding crosses into a colleague's domain (e.g. you found a pricing issue but shipping data would confirm the cause). Phrase a specific, answerable question and include the relevant numbers you already found.",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "The colleague's id, e.g. 'pricing', 'shipping', 'finance'.",
        },
        question: {
          type: "string",
          description:
            "A specific question, with the context/numbers they need to answer it.",
        },
      },
      required: ["agent_id", "question"],
    },
    run: async (input) => {
      const agentId = String(input.agent_id ?? "");
      const question = String(input.question ?? "");
      if (agentId === agent.id) return "You cannot consult yourself.";
      const colleague = effectiveAgent(agentId);
      if (!colleague) return `No manager with id "${agentId}" exists.`;
      if (!colleague.enabled) {
        return `${colleague.name} is currently disabled by the store owner — answer with the data you have, or recommend the owner re-enable that department.`;
      }
      if (depth >= MAX_CONSULT_DEPTH) {
        return "Consultation depth limit reached — answer with the data you already have.";
      }
      try {
        return await runAgent(agentId, question, depth + 1);
      } catch (err) {
        return `Consultation failed: ${(err as Error).message}`;
      }
    },
  };

  const calculate: ToolDef = {
    name: "calculate",
    description:
      "Evaluate a basic arithmetic expression (numbers, + - * / % ( ) .) for exact metrics like AOV, rates, and percentage changes. Use this instead of doing arithmetic in your head when precision matters.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "e.g. '(45200 / 312)' or '(89 - 64) / 64 * 100'",
        },
      },
      required: ["expression"],
    },
    run: async (input) => {
      const expression = String(input.expression ?? "");
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
  };

  return [sallaRead, consultAgent, calculate];
}
