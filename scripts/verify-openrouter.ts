/**
 * Live OpenRouter verification — run from any machine with normal egress:
 *
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/verify-openrouter.ts
 *
 * Uses a cheap tool-calling model by default (override: VERIFY_MODEL).
 * Exercises the three live paths the sandbox cannot reach:
 *   1. key validation (the dashboard System-check path)
 *   2. structured JSON output (daily-report action extraction / curator path)
 *   3. a real agent loop with tool calling (chat / daily-analysis path)
 * Total cost: well under $0.05.
 */
import { updateSettings } from "../src/settings/settings.js";
import { testOpenRouter, structuredJson } from "../src/llm/client.js";
import { runAgent } from "../src/agents/runner.js";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("Set OPENROUTER_API_KEY first.");
  process.exit(1);
}
const model = process.env.VERIFY_MODEL ?? "openai/gpt-4o-mini";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

updateSettings({ openRouter: { apiKey: key, model } });

// 1. Key validation
try {
  check("key validation", true, await testOpenRouter());
} catch (err) {
  check("key validation", false, (err as Error).message);
}

// 2. Structured JSON (the extraction/curator path)
try {
  const parsed = await structuredJson<{ actions: { title: string; priority: number }[] }>(
    'Return exactly one action: title "test", priority 1.',
    {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, priority: { type: "integer" } },
            required: ["title", "priority"],
            additionalProperties: false,
          },
        },
      },
      required: ["actions"],
      additionalProperties: false,
    },
    "actions",
    500
  );
  check("structured JSON output", parsed.actions?.[0]?.title === "test", JSON.stringify(parsed));
} catch (err) {
  check("structured JSON output", false, (err as Error).message);
}

// 3. Real agent loop with tool calling (calculate tool forces a round trip).
//    Works without a connected store — salla_read failing gracefully is itself
//    part of the test.
try {
  const reply = await runAgent(
    "finance",
    "Use your calculate tool to compute 173 * 19 exactly, and reply with just the number and one short sentence."
  );
  check("agent loop + tool calling", reply.includes("3287"), reply.slice(0, 120).replace(/\n/g, " "));
} catch (err) {
  check("agent loop + tool calling", false, (err as Error).message);
}

console.log(failures === 0 ? "\nAll live checks passed ✅" : `\n${failures} check(s) failed ❌`);
process.exit(failures === 0 ? 0 : 1);
