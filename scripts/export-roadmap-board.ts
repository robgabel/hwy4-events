// One-time archive of the retired Roadmap board (issue #325). Writes every
// `hwy4_tasks` row to docs/research/2026-10-roadmap-board-export.json so the
// history survives the table. Run it, commit the JSON, and only then apply the
// migration that drops `hwy4_tasks` and `hwy4_task_ref_seq` (Rob's OK first).
//
// Read-only against the database.
//
// Run: cd scripts && SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx export-roadmap-board.ts

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { supabaseAdmin } from "./lib/supabase-admin.js";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/research/2026-10-roadmap-board-export.json");

async function main() {
  const { data, error } = await supabaseAdmin.from("hwy4_tasks").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`hwy4_tasks read failed: ${error.message}`);
  const rows = data ?? [];
  writeFileSync(
    OUT,
    JSON.stringify({ exported_at: new Date().toISOString(), source: "hwy4_tasks", issue: 325, count: rows.length, rows }, null, 2) +
      "\n"
  );
  console.log(`Wrote ${rows.length} rows to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
