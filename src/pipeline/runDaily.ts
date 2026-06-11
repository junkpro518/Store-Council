import { runDailyAnalysis } from "./daily.js";

// Manual trigger: `npm run daily-run`
runDailyAnalysis()
  .then((report) => {
    console.log(`Daily report for ${report.date} complete.\n`);
    console.log(report.summary);
  })
  .catch((err) => {
    console.error("Daily analysis failed:", err);
    process.exit(1);
  });
