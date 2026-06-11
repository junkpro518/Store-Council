import { runDailyAnalysis } from "./daily.js";
import { initStorage, flushStorage } from "../store/jsonStore.js";

// Manual trigger: `npm run daily-run`
await initStorage();
runDailyAnalysis()
  .then(async (report) => {
    await flushStorage();
    return report;
  })
  .then((report) => {
    console.log(`Daily report for ${report.date} complete.\n`);
    console.log(report.summary);
  })
  .catch((err) => {
    console.error("Daily analysis failed:", err);
    process.exit(1);
  });
