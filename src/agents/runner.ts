import Anthropic from "@anthropic-ai/sdk";
import {
  llm,
  modelId,
  openRouterChat,
  OpenRouterMessage,
} from "../llm/client.js";
import { getSettings } from "../settings/settings.js";
import { effectiveAgent } from "./definitions.js";
import { systemPrompt } from "./prompts.js";
import { buildTools, ToolDef } from "./tools.js";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

const MAX_ITERATIONS = 20;

/**
 * Run one agent to completion on a question, with its tools (Salla read
 * access, inter-agent consultation, calculator). Returns the final text.
 *
 * The agentic loop runs on whichever provider the owner selected in
 * Settings: Anthropic (default) or OpenRouter.
 */
export async function runAgent(
  agentId: string,
  question: string,
  depth = 0,
  history: Turn[] = []
): Promise<string> {
  const agent = effectiveAgent(agentId);
  if (!agent) throw new Error(`Unknown agent "${agentId}"`);
  if (!agent.enabled) {
    throw new Error(`${agent.name} is disabled. Enable it from the Managers page.`);
  }

  const tools = buildTools(agent, (id, q, d) => runAgent(id, q, d), depth);
  const system = systemPrompt(agent);
  const turns: Turn[] = [...history, { role: "user", content: question }];

  return getSettings().provider === "openrouter"
    ? runOpenRouterLoop(system, turns, tools)
    : runAnthropicLoop(system, turns, tools);
}

async function runTool(tools: ToolDef[], name: string, input: unknown): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Unknown tool "${name}".`;
  try {
    return await tool.run((input ?? {}) as Record<string, unknown>);
  } catch (err) {
    return `Tool error: ${(err as Error).message}`;
  }
}

// ---------- Anthropic Messages API loop ----------

async function runAnthropicLoop(
  system: string,
  turns: Turn[],
  tools: ToolDef[]
): Promise<string> {
  const client = llm();
  const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
  const messages: Anthropic.MessageParam[] = turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  let response: Anthropic.Message | undefined;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    response = await client.messages.create({
      model: modelId(),
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      tools: anthropicTools,
      messages,
    });

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: await runTool(tools, block.name, block.input),
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return (response?.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ---------- OpenRouter (OpenAI-compatible function calling) loop ----------

async function runOpenRouterLoop(
  system: string,
  turns: Turn[],
  tools: ToolDef[]
): Promise<string> {
  const messages: OpenRouterMessage[] = [
    { role: "system", content: system },
    ...turns.map((t) => ({ role: t.role, content: t.content })),
  ];
  const orTools = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const data = await openRouterChat({ messages, tools: orTools });
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("OpenRouter returned an empty response.");
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return msg.content ?? "";

    for (const call of calls) {
      let input: unknown = {};
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* leave as {} — tool will report missing args */
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: await runTool(tools, call.function.name, input),
      });
    }
  }
  return "(Stopped: the agent used too many tool calls without concluding.)";
}
