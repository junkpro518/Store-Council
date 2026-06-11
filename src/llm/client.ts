import { openRouterKey, getSettings } from "../settings/settings.js";

/**
 * LLM access — the platform routes ALL transactions through OpenRouter
 * (OpenAI-compatible chat-completions), giving one account, one bill, and
 * access to any tool-calling model on openrouter.ai/models.
 */

export const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

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
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Store Council",
      },
      body: JSON.stringify({ model: getSettings().openRouter.model, ...body }),
    });
    // Transient failures (rate limit / upstream) get bounded retries.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    return (await res.json()) as { choices?: { message?: OpenRouterMessage }[] };
  }
}

/**
 * One-shot structured JSON call on the active provider. Returns the parsed
 * object or throws. Used for action extraction and memory curation.
 */
export async function structuredJson<T>(
  prompt: string,
  schema: Record<string, unknown>,
  name: string,
  maxTokens = 8000
): Promise<T> {
  const data = await openRouterChat({
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: { name, strict: true, schema },
    },
  });
  const text = data.choices?.[0]?.message?.content ?? undefined;
  if (!text) throw new Error("Empty structured response");
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(cleaned) as T;
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
