/**
 * End-to-end test against a faithful mock of the OpenRouter API.
 * Proves the full stack with real HTTP — agent loop, tool dispatch,
 * structured output, and MCP — without spending tokens or needing egress:
 *
 *   npx tsx tests/e2e-mock-openrouter.ts
 *
 * (OPENROUTER_BASE_URL is set programmatically before importing the client.)
 */
import http from "node:http";

process.env.OPENROUTER_BASE_URL = "http://127.0.0.1:4999/api/v1";
process.env.DATA_DIR = "./data-e2e";

const { updateSettings } = await import("../src/settings/settings.js");
const { testOpenRouter, structuredJson } = await import("../src/llm/client.js");
const { runAgent } = await import("../src/agents/runner.js");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---------- Mock OpenRouter ----------
let chatCalls = 0;
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url?.endsWith("/key")) {
      res.end(JSON.stringify({ data: { label: "mock-key" } }));
      return;
    }
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      chatCalls++;
      const parsed = JSON.parse(body);
      if (!parsed.messages?.some((m: { role: string }) => m.role === "system")) {
        // structuredJson path has no system message in our implementation
        res.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content:
            '{"actions":[{"title":"test","manager":"pricing","what":"w","why":"y","how":"h","impact":"i","priority":1}]}' } }],
        }));
        return;
      }
      const toolMsg = parsed.messages.findLast((m: { role: string }) => m.role === "tool");
      if (toolMsg) {
        // Second round: echo the real tool result back, proving dispatch happened.
        res.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: `الناتج هو ${toolMsg.content}` } }],
        }));
      } else {
        // First round: the "model" requests the calculate tool.
        const hasCalc = parsed.tools?.some(
          (t: { function?: { name?: string } }) => t.function?.name === "calculate");
        res.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{
            id: "call_1", type: "function",
            function: { name: hasCalc ? "calculate" : "missing", arguments: '{"expression":"173*19"}' },
          }] } }],
        }));
      }
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

await new Promise<void>((r) => mock.listen(4999, "127.0.0.1", r));
updateSettings({ openRouter: { apiKey: "sk-or-mock", model: "mock/model" } });

// 1. Key validation path (dashboard System check)
check("key validation", (await testOpenRouter()) === "mock-key");

// 2. Structured output path (action extraction / curator)
const parsed = await structuredJson<{ actions: { title: string }[] }>(
  "extract", { type: "object" }, "actions");
check("structured JSON parsing", parsed.actions?.[0]?.title === "test");

// 3. Full agent loop: prompt assembly -> tool serialization -> model tool_call
//    -> REAL calculate execution -> result returned to model -> final text.
const reply = await runAgent("finance", "كم حاصل 173 في 19؟");
check("agent loop + real tool dispatch", reply.includes("3287"), reply.slice(0, 60));
check("loop made 2 model calls", chatCalls >= 2, `calls=${chatCalls}`);

// 4. Read-only enforcement survives the loop (forceReadOnly = no salla_write)
updateSettings({ writeMode: "auto" });
const before = chatCalls;
await runAgent("pricing", "question", 0, [], { forceReadOnly: true });
check("forceReadOnly loop completes", chatCalls > before);

mock.close();
const { rmSync } = await import("node:fs");
rmSync("./data-e2e", { recursive: true, force: true });
console.log(failures === 0 ? "\nE2E (mock) all green ✅" : `\n${failures} failed ❌`);
process.exit(failures === 0 ? 0 : 1);
