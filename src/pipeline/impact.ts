import { runAgent } from "../agents/runner.js";
import { remember } from "../agents/memory.js";
import { dueForMeasurement, recordMeasurement } from "./daily.js";

/**
 * The impact-measurement loop — the accountability moat from docs/STRATEGY.md.
 *
 * ~14 days after the owner marks a recommendation "done", the owning manager
 * re-pulls the metric it originally cited and reports the measured outcome.
 * Results land on the action item (the achievement ledger) and in the
 * manager's memory, so future recommendations build on what verifiably
 * worked. Runs after each daily analysis, bounded per day.
 */

const MAX_PER_RUN = 4;
const MEASURE_AFTER_DAYS = 14;

export async function runImpactMeasurements(): Promise<number> {
  const due = dueForMeasurement(MEASURE_AFTER_DAYS).slice(0, MAX_PER_RUN);
  for (const { date, index, action } of due) {
    try {
      const result = await runAgent(
        action.manager,
        `Impact measurement task. On ${date} you recommended: "${action.title}".
Your evidence then (Why): ${action.why}
Expected impact: ${action.impact}
The owner implemented it around ${action.statusChangedAt?.slice(0, 10)}.

Now MEASURE what actually happened: re-pull the metric(s) you cited (salla_read / metrics_history), compare before vs. after implementation, and report the measured impact in 2-4 sentences with the numbers. Be honest — "no measurable change yet" and "it got worse" are valid findings. End with one line starting "VERDICT:" — improved / no change / worse / too early to tell. Estimate the SAR/month effect when the data allows it.`
      );
      recordMeasurement(date, index, result);
      remember(
        action.manager,
        "lesson",
        `Measured outcome of "${action.title}" (implemented ${action.statusChangedAt?.slice(0, 10)}): ${result.slice(0, 350)}`
      );
    } catch (err) {
      console.error(`[impact] measurement failed for ${date}#${index}:`, err);
    }
  }
  return due.length;
}
