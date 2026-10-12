/**
 * Files one agent_actions notice when the daily scrape job did not succeed.
 * The workflow runs this only when the scrape job result is not success
 * (a failed step, or a timeout-minutes kill reported as cancelled).
 * A successful scrape files nothing here; source throws are noticed inside
 * scrape.ts, which still exits 0.
 *
 * Exit 1 only when the insert fails, so this job itself goes red.
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { fileJobAlertFromEnv, type ScrapeAlertClient } from "../lib/scrape-alerts.js";

async function main() {
  const r = await fileJobAlertFromEnv(
    process.env,
    supabaseAdmin as unknown as ScrapeAlertClient
  );
  if (r.code !== 0) console.error(`SCRAPE_ALERT ${r.status}: ${r.detail}`);
  else console.log(`SCRAPE_ALERT ${r.status}: ${r.detail}`);
  process.exit(r.code);
}

main().catch((err) => {
  console.error("SCRAPE_ALERT error:", err);
  process.exit(1);
});
