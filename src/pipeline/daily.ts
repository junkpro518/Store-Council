import { AGENTS } from "../agents/definitions.js";
import { runAgent } from "../agents/runner.js";
import { JsonStore } from "../store/jsonStore.js";

export interface DailyReport {
  date: string; // YYYY-MM-DD
  startedAt: string;
  finishedAt: string;
  summary: string; // the GM's consolidated report
  departments: Record<string, string>; // agentId -> findings
}

const reportStore = new JsonStore<DailyReport[]>("daily-reports", []);

const DAILY_BRIEF = `Run your daily analysis of the store.
- Pull the data you need for your standing focus areas (recent orders, the relevant lists, etc.). Compare against the last 30 days where possible.
- Produce your TOP 3 findings for today, each as a full recommendation (What / Why with numbers / How — exact Salla dashboard steps / Expected impact).
- If a finding crosses into a colleague's domain, consult them before finalizing it.
- If nothing in your domain needs attention today, say so explicitly and note the one metric you'll watch.`;

const CONCURRENCY = 4;

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    })
  );
  return results;
}

export async function runDailyAnalysis(): Promise<DailyReport> {
  const startedAt = new Date().toISOString();
  const date = startedAt.slice(0, 10);

  const findings = await mapLimited(AGENTS, CONCURRENCY, async (agent) => {
    try {
      const text = await runAgent(agent.id, DAILY_BRIEF);
      return [agent.id, text] as const;
    } catch (err) {
      return [agent.id, `(analysis failed: ${(err as Error).message})`] as const;
    }
  });
  const departments = Object.fromEntries(findings);

  const consolidationPrompt = `Today is ${date}. Below are today's findings from all 14 department managers. Produce the owner's daily report:

1. **Executive summary** — 3 sentences on the state of the store.
2. **Top 5 actions for today**, ranked by expected impact vs. effort. For each, keep the owning manager's What/Why/How/Impact but tighten it. Resolve any conflicts between departments and say how you resolved them.
3. **Watchlist** — items not urgent today but trending toward a problem.
4. Credit each item to its manager (e.g. "— Pricing Manager") so the owner knows whom to chat with for details.

${findings.map(([id, text]) => `\n## Findings from ${id}\n${text}`).join("\n")}`;

  const summary = await runAgent("gm", consolidationPrompt);

  const report: DailyReport = {
    date,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    departments,
  };
  reportStore.update((reports) => [
    ...reports.filter((r) => r.date !== date),
    report,
  ]);
  return report;
}

export function listReports(): DailyReport[] {
  return reportStore.read();
}

export function getReport(date: string): DailyReport | undefined {
  return reportStore.read().find((r) => r.date === date);
}
