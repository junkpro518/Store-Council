import Anthropic from "@anthropic-ai/sdk";
import {
  anthropicKey,
  openRouterKey,
  getSettings,
} from "../settings/settings.js";

/**
 * Anthropic client built from current settings (the owner can change the API
 * key from the dashboard at any time, so construct lazily per use).
 */
export function llm(): Anthropic {
  const apiKey = anthropicKey();
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key configured. Add it in Settings (الإعدادات) on the dashboard."
    );
  }
  return new Anthropic({ apiKey });
}

export function modelId(): string {
  return getSettings().model || "claude-opus-4-8";
}

// ---------- OpenRouter (alternative provider, OpenAI-compatible) ----------

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export async function openRouterChat(body: Record<string, unknown>): Promise<{
  choices?: { message?: OpenRouterMessage }[];
}> {
  const apiKey = openRouterKey();
  if (!apiKey) {
    throw new Error(
      "No OpenRouter API key configured. Add it in Settings on the dashboard."
    );
  }
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Store Council",
    },
    body: JSON.stringify({ model: getSettings().openRouter.model, ...body }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return (await res.json()) as { choices?: { message?: OpenRouterMessage }[] };
}

/** Validate the OpenRouter key (diagnostics). */
export async function testOpenRouter(): Promise<string> {
  const apiKey = openRouterKey();
  if (!apiKey) throw new Error("No OpenRouter API key configured.");
  const res = await fetch(`${OPENROUTER_BASE}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter key check failed (${res.status})`);
  const data = (await res.json()) as { data?: { label?: string } };
  return data.data?.label ?? "API key valid";
}
