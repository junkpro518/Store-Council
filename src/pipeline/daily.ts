import { enabledSpecialists } from "../agents/definitions.js";
import { runAgent } from "../agents/runner.js";
import { structuredJson } from "../llm/client.js";
import { getSettings } from "../settings/settings.js";
import { JsonStore } from "../store/jsonStore.js";
import { remember } from "../agents/memory.js";
import { resetBoard, boardAsText } from "../agents/board.js";
import { captureSnapshot } from "./metrics.js";
import { curationDue, runCurator } from "./curator.js";

export type ActionStatus = "new" | "done" | "dismissed";

export interface ActionItem {
  title: string;
  manager: string; // agent id credited with the recommendation
  what: string;
  why: string;
  how: string; // step-by-step Salla dashboard instructions
  impact: string;
  priority: number; // 1 = highest
  status: ActionStatus;
  /** When the owner last changed the status (set on done/dismissed). */
  statusChangedAt?: string;
  /** Filled by the impact-measurement loop ~14 days after "done". */
  measuredAt?: string;
  measuredImpact?: string;
}

export interface DailyReport {
  date: string; // YYYY-MM-DD
  startedAt: string;
  finishedAt: string;
  summary: string; // the GM's consolidated report (markdown)
  actions: ActionItem[]; // structured, trackable action items
  departments: Record<string, string>; // agentId -> findings
}

const reportStore = new JsonStore<DailyReport[]>("daily-reports", []);

const DAILY_BRIEF = `Run your daily analysis of the store as part of today's council session.
- Start from your memory and the metrics_history trend, then pull the data you need for your standing focus areas. Compare against the last 30 days where possible.
- POST your single most important finding to the council_board as soon as you have it (1-2 sentences with the key number), and READ the board before finalizing — a colleague's discovery may explain or outrank yours.
- Produce your TOP 3 findings for today, each as a full recommendation (What / Why with numbers / How — exact Salla dashboard steps / Expected impact).
- If a finding crosses into a colleague's domain, consult them before finalizing it.
- If you learned something durable today (a pattern, a mistake in your past reasoning, an owner constraint), save_memory it.
- If a finding depends on a decision or fact only the owner has (after checking your knowledge_base and memory), ask_owner instead of guessing — then proceed with your best explicit assumption, labeled as such.
- If nothing in your domain needs attention today, say so explicitly and note the one metric you'll watch.`;

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

const ACTIONS_SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          manager: { type: "string" },
          what: { type: "string" },
          why: { type: "string" },
          how: { type: "string" },
          impact: { type: "string" },
          priority: { type: "integer" },
        },
        required: ["title", "manager", "what", "why", "how", "impact", "priority"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
} as const;

const EXTRACT_PROMPT = (summary: string) =>
  `Extract every action item from this daily store report into the JSON schema. Keep the original language of the report. "manager" must be the department id mentioned (one of: catalog, pricing, marketing, seo, cro, customer-service, retention, orders, shipping, inventory, finance, reviews, payments, growth, gm). "how" must contain the full step-by-step dashboard instructions. priority 1 = most important.\n\n---\n${summary}`;

/** Extract structured, trackable actions from the GM's report. */
async function extractActions(summary: string): Promise<ActionItem[]> {
  try {
    const parsed = await structuredJson<{ actions: Omit<ActionItem, "status">[] }>(
      EXTRACT_PROMPT(summary),
      ACTIONS_SCHEMA as unknown as Record<string, unknown>,
      "actions"
    );
    return parsed.actions
      .sort((a, b) => a.priority - b.priority)
      .map((a) => ({ ...a, status: "new" as const }));
  } catch {
    return [];
  }
}

export async function runDailyAnalysis(): Promise<DailyReport> {
  const settings = getSettings();
  const startedAt = new Date().toISOString();
  const date = startedAt.slice(0, 10);
  const specialists = enabledSpecialists();

  // Team session setup: fresh shared board + today's KPI snapshot.
  resetBoard(date);
  try {
    await captureSnapshot(date);
  } catch (err) {
    console.error("Metrics snapshot failed:", err);
  }

  const findings = await mapLimited(
    specialists,
    settings.analysisConcurrency,
    async (agent) => {
      try {
        const text = await runAgent(agent.id, DAILY_BRIEF);
        return [agent.id, text] as const;
      } catch (err) {
        return [agent.id, `(analysis failed: ${(err as Error).message})`] as const;
      }
    }
  );
  const departments = Object.fromEntries(findings);

  const consolidationPrompt = `Today is ${date}. Below are today's findings from all department managers. Produce the owner's daily report:

1. **Executive summary** — 3 sentences on the state of the store.
2. **Top ${settings.topActionsCount} actions for today**, ranked by expected impact vs. effort. For each, keep the owning manager's What/Why/How/Impact but tighten it. Resolve any conflicts between departments and say how you resolved them.
3. **Watchlist** — items not urgent today but trending toward a problem.
4. Credit each item to its manager id in the form "— manager: pricing" so the owner knows whom to chat with for details.

## Council board (headline findings the team shared during the session)
${boardAsText()}

${findings.map(([id, text]) => `\n## Findings from ${id}\n${text}`).join("\n")}`;

  const summary = await runAgent("gm", consolidationPrompt);

  let actions: ActionItem[] = [];
  try {
    actions = await extractActions(summary);
  } catch (err) {
    console.error("Action extraction failed:", err);
  }

  const report: DailyReport = {
    date,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    actions,
    departments,
  };
  reportStore.update((reports) => [
    ...reports.filter((r) => r.date !== date),
    report,
  ]);

  // Post-run background work: impact measurements for actions implemented
  // ~2 weeks ago, then memory curation when due.
  void (async () => {
    try {
      const { runImpactMeasurements } = await import("./impact.js");
      const measured = await runImpactMeasurements();
      if (measured > 0) console.log(`[impact] measured ${measured} implemented action(s)`);
    } catch (err) {
      console.error("[impact] loop failed:", err);
    }
    if (curationDue()) {
      runCurator().catch((err) => console.error("[curator] run failed:", err));
    }
  })();

  return report;
}

export function listReports(): DailyReport[] {
  return reportStore
    .read()
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getReport(date: string): DailyReport | undefined {
  return reportStore.read().find((r) => r.date === date);
}

/** Actions implemented ≥`ageDays` ago and not yet measured (for the impact loop). */
export function dueForMeasurement(ageDays = 14): { date: string; index: number; action: ActionItem }[] {
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  const due: { date: string; index: number; action: ActionItem }[] = [];
  for (const r of reportStore.read()) {
    r.actions.forEach((a, index) => {
      if (
        a.status === "done" &&
        !a.measuredAt &&
        a.statusChangedAt &&
        Date.parse(a.statusChangedAt) < cutoff
      ) {
        due.push({ date: r.date, index, action: a });
      }
    });
  }
  return due;
}

export function recordMeasurement(date: string, index: number, measuredImpact: string): void {
  reportStore.update((reports) =>
    reports.map((r) =>
      r.date !== date
        ? r
        : {
            ...r,
            actions: r.actions.map((a, i) =>
              i === index
                ? { ...a, measuredAt: new Date().toISOString(), measuredImpact }
                : a
            ),
          }
    )
  );
}

/** The achievement ledger: every implemented action with its measured impact. */
export function achievements(): (ActionItem & { date: string })[] {
  return reportStore
    .read()
    .flatMap((r) =>
      r.actions
        .filter((a) => a.status === "done")
        .map((a) => ({ ...a, date: r.date }))
    )
    .sort((a, b) => (a.statusChangedAt ?? a.date) < (b.statusChangedAt ?? b.date) ? 1 : -1);
}

export function setActionStatus(
  date: string,
  index: number,
  status: ActionStatus
): DailyReport | undefined {
  let updated: DailyReport | undefined;
  let action: ActionItem | undefined;
  reportStore.update((reports) =>
    reports.map((r) => {
      if (r.date !== date || !r.actions[index]) return r;
      action = r.actions[index];
      const actions = r.actions.map((a, i) =>
        i === index ? { ...a, status, statusChangedAt: new Date().toISOString() } : a
      );
      updated = { ...r, actions };
      return updated;
    })
  );

  // Learning loop: the owning manager remembers how the owner responded, so
  // rejected advice isn't repeated and accepted advice is reinforced.
  if (action && action.status !== status && (status === "done" || status === "dismissed")) {
    const verb =
      status === "done"
        ? "The owner IMPLEMENTED my recommendation"
        : "The owner DISMISSED my recommendation";
    remember(
      action.manager,
      "feedback",
      `${verb} (${date}): "${action.title}". ${
        status === "dismissed"
          ? "Don't re-propose it as-is; if still important, find a different angle or ask the owner why in chat."
          : "This direction resonates — follow up on its measured impact in ~2 weeks."
      }`
    );
  }
  return updated;
}
