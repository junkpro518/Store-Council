import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { getAgent } from "./definitions.js";
import { systemPrompt } from "./prompts.js";
import { buildTools } from "./tools.js";

const client = new Anthropic();

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Run one agent to completion on a question, with its tools (Salla read
 * access, inter-agent consultation, calculator). Returns the final text.
 *
 * `history` carries prior chat turns when the owner is talking to the agent
 * directly; the daily pipeline calls it with no history.
 */
export async function runAgent(
  agentId: string,
  question: string,
  depth = 0,
  history: Turn[] = []
): Promise<string> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Unknown agent "${agentId}"`);

  const tools = buildTools(agent, (id, q, d) => runAgent(id, q, d), depth);

  const finalMessage = await client.beta.messages.toolRunner({
    model: config.anthropicModel,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: systemPrompt(agent),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools,
    messages: [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: question },
    ],
    max_iterations: 20,
  });

  return finalMessage.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
