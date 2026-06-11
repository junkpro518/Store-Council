import { EffectiveAgent, effectiveAgent } from "./definitions.js";
import { sallaGet, sallaGetAll } from "../salla/client.js";
import { remember } from "./memory.js";
import { postNote, boardAsText } from "./board.js";
import { metricsHistory } from "../pipeline/metrics.js";
import { playbooksFor, getPlaybook } from "./skills.js";
import { isWriteAllowed } from "../salla/client.js";
import { requestChange } from "../changes/changes.js";
import { visibleDocs, getVisibleDoc } from "./knowledge.js";
import { askOwner } from "./questions.js";

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

  const saveMemory: ToolDef = {
    name: "save_memory",
    description:
      "Save something to your long-term memory so future analyses and chats start from it. Use type 'lesson' when you discover you were wrong or a recommendation didn't land (state what you'll do differently), 'fact' for durable store facts (owner constraints, supplier lead times, seasonal patterns), 'feedback' for the owner's expressed preferences. Keep each memory one dense sentence. Do NOT save raw data that's one API call away.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["lesson", "fact", "feedback"] },
        content: { type: "string", description: "One dense, self-contained sentence." },
      },
      required: ["type", "content"],
    },
    run: async (input) => {
      const type = String(input.type ?? "fact");
      if (!["lesson", "fact", "feedback"].includes(type)) {
        return "type must be lesson | fact | feedback";
      }
      const content = String(input.content ?? "").trim();
      if (content.length < 10) return "Memory too short to be useful — write a full sentence.";
      remember(agent.id, type as "lesson" | "fact" | "feedback", content);
      return "Saved to your long-term memory.";
    },
  };

  const councilBoard: ToolDef = {
    name: "council_board",
    description:
      "The council's shared board for today's analysis. action='read' shows what your colleagues have found so far (do this BEFORE finalizing your findings — their discoveries often explain yours, e.g. a sales drop the Logistics Manager traced to courier delays). action='post' shares a headline finding of yours: one or two sentences with the key number, so colleagues and the General Manager can build on it.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "post"] },
        content: {
          type: "string",
          description: "Required for 'post': the finding, 1-2 sentences with the key number.",
        },
      },
      required: ["action"],
    },
    run: async (input) => {
      if (input.action === "post") {
        const content = String(input.content ?? "").trim();
        if (content.length < 10) return "Post a substantive finding (1-2 sentences with a number).";
        postNote(agent.id, content);
        return "Posted to the council board.";
      }
      return boardAsText(agent.id);
    },
  };

  const metrics: ToolDef = {
    name: "metrics_history",
    description:
      "The store's daily KPI time series captured by the platform (orders, customers, products, abandoned carts — cumulative totals per day). Use it to detect trends and compare today against real history instead of re-counting via many API calls. Day-over-day deltas = new orders/customers that day.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", description: "How many days back (default 30, max 365)." },
      },
    },
    run: async (input) => {
      const days = Math.min(Math.max(Number(input.days) || 30, 1), 365);
      const series = metricsHistory(days);
      if (series.length === 0) {
        return "No metrics history yet — it accumulates one snapshot per daily analysis. Use salla_read for current numbers.";
      }
      return JSON.stringify(series);
    },
  };

  const readPlaybook: ToolDef = {
    name: "read_playbook",
    description: `Load one of your expert playbooks in full. Available to you: ${playbooksFor(agent.id).map((p) => p.name).join(", ") || "(none)"}. Read the relevant playbook before analyzing its topic — it contains field-tested methods and benchmarks for this market.`,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playbook name, e.g. 'methodology'." },
      },
      required: ["name"],
    },
    run: async (input) => {
      const book = getPlaybook(String(input.name ?? ""));
      if (!book) {
        return `No playbook named "${input.name}". Yours: ${playbooksFor(agent.id).map((p) => p.name).join(", ")}`;
      }
      if (!book.agents.includes("all") && !book.agents.includes(agent.id)) {
        return `"${book.name}" belongs to other departments (${book.agents.join(", ")}) — consult that manager instead.`;
      }
      return book.body;
    },
  };

  const knowledgeBase: ToolDef = {
    name: "knowledge_base",
    description:
      "Documents the store owner provided to you beyond Salla data (supplier terms, brand guidelines, policies, market notes). action='list' shows titles+ids; action='read' loads one document. Consult it BEFORE assuming anything in an area it covers — owner-provided facts beat your assumptions.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read"] },
        doc_id: { type: "string", description: "Required for 'read'." },
      },
      required: ["action"],
    },
    run: async (input) => {
      if (input.action === "read") {
        const doc = getVisibleDoc(agent.id, String(input.doc_id ?? ""));
        return doc
          ? `# ${doc.title}\n(updated ${doc.updatedAt.slice(0, 10)})\n\n${doc.content}`
          : "No document with that id in your knowledge base. Use action='list'.";
      }
      const docs = visibleDocs(agent.id);
      return docs.length
        ? docs.map((v) => `[${v.doc.id}] ${v.doc.title}${v.scope === "shared" ? " (shared)" : ""}`).join("\n")
        : "Your knowledge base is empty — the owner hasn't added documents yet.";
    },
  };

  const askOwnerTool: ToolDef = {
    name: "ask_owner",
    description:
      "Send a question to the store owner's inbox when a decision or missing fact only THEY can resolve blocks better advice (budgets, supplier terms, brand strategy, intent behind a change you observed). Use during autonomous analysis — in live chat, just ask in your reply instead. Check your memory and knowledge_base first; never ask what data can answer. After asking, proceed with your best explicit assumption.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "One focused, answerable question." },
        context: { type: "string", description: "Why you're asking — the finding/decision it unblocks, with the key number." },
      },
      required: ["question", "context"],
    },
    run: async (input) => {
      const question = String(input.question ?? "").trim();
      const context = String(input.context ?? "").trim();
      if (question.length < 10) return "Ask a real, complete question.";
      return askOwner(agent.id, question, context);
    },
  };

  const tools = [
    sallaRead,
    consultAgent,
    councilBoard,
    readPlaybook,
    knowledgeBase,
    askOwnerTool,
    saveMemory,
    metrics,
    calculate,
  ];

  if (agent.writeMode !== "read_only") {
    const confirmMode = agent.writeMode === "confirm";
    const sallaWriteTool: ToolDef = {
      name: "salla_write",
      description: confirmMode
        ? "PROPOSE a change to the store. The owner enabled edit-with-confirmation: your change is queued and applied only after the owner approves it on the dashboard. Allowed: POST/PUT on products, coupons, specialoffers, categories — never anything destructive. Always fetch the current object with salla_read first and change only the fields you intend to. Include a clear description of what changes and why."
        : "Apply a change to the store DIRECTLY (the owner enabled edit-without-confirmation — be conservative). Allowed: POST/PUT on products, coupons, specialoffers, categories — never anything destructive. Always fetch the current object with salla_read first, change only the intended fields, and double-check the payload. When in doubt, recommend instead of writing.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["POST", "PUT"] },
          endpoint: {
            type: "string",
            description: 'e.g. "products/12345" (PUT) or "coupons" (POST).',
          },
          payload: {
            type: "object",
            description: "The request body — only the fields being set/changed.",
            additionalProperties: true,
          },
          description: {
            type: "string",
            description: "Human summary for the owner: what changes, on what, and why (1-2 sentences).",
          },
        },
        required: ["method", "endpoint", "payload", "description"],
      },
      run: async (input) => {
        const method = String(input.method ?? "").toUpperCase() as "POST" | "PUT";
        const endpoint = String(input.endpoint ?? "");
        const description = String(input.description ?? "").trim();
        if (!["POST", "PUT"].includes(method)) return "method must be POST or PUT.";
        if (!isWriteAllowed(method, endpoint)) {
          return `${method} ${endpoint} is not on the write allowlist (products, coupons, specialoffers, categories; no deletes). Recommend it to the owner in your report instead.`;
        }
        if (description.length < 15) {
          return "Provide a real description — the owner decides based on it.";
        }
        const payload = (input.payload ?? {}) as Record<string, unknown>;
        if (Object.keys(payload).length === 0) return "Payload is empty.";
        try {
          return await requestChange(
            agent.id,
            agent.writeMode as "confirm" | "auto",
            method,
            endpoint,
            payload,
            description
          );
        } catch (err) {
          return `Change request failed: ${(err as Error).message}`;
        }
      },
    };
    tools.push(sallaWriteTool);
  }

  return tools;
}
