/**
 * One-time + repeatable backfill for the description quality work (WS-1.2 / WS-2).
 *
 * Cleans calendar-widget junk (Add to calendar / Google Calendar / iCal / Outlook /
 * Date: / Time: …) out of already-stored `hwy4_events.description` rows, using the
 * SAME pure sanitizer the render path and the ingestion write-path use
 * (lib/description-quality.ts), so the cleanup can't drift from what ships.
 *
 * It only ever SANITIZES stored text. It does NOT null-out "suppress"-verdict
 * rows: suppression is a render-time decision (the gate hides them live and
 * self-heals when a better description is scraped), so we never destroy the
 * underlying text. Locked rows (`description_locked = true`) are never touched.
 *
 * Modes:
 *   (default)   dry-run — list rows that WOULD be cleaned, change nothing
 *   --report    read-only — print sanitize/suppress/rewrite tallies (weekly cron
 *               signal for upstream source rot; §12), change nothing
 *   --apply     write the sanitized text back (idempotent: re-running is a no-op)
 *   --all       include past-dated rows (default: today onward)
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx content-fixes/sanitize-descriptions.ts
 *   ...                                            tsx content-fixes/sanitize-descriptions.ts --report
 *   ...                                            tsx content-fixes/sanitize-descriptions.ts --apply
 */
import { supabaseAdmin } from "../lib/supabase-admin.js";
import {
  sanitizeDescriptionDetailed,
  assessDescription,
} from "../../lib/description-quality.js";

const APPLY = process.argv.includes("--apply");
const REPORT = process.argv.includes("--report");
const ALL_DATES = process.argv.includes("--all");

interface Row {
  id: string;
  name: string;
  venue_name: string | null;
  town: string | null;
  description: string | null;
  description_locked: boolean | null;
}

async function main() {
  let query = supabaseAdmin
    .from("hwy4_events")
    .select("id, name, venue_name, town, description, description_locked")
    .not("description", "is", null);
  if (!ALL_DATES) {
    query = query.gte("date", new Date().toISOString().split("T")[0]);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  let scanned = 0;
  let wouldClean = 0;
  let cleaned = 0;
  let skippedLocked = 0;
  const verdicts: Record<string, number> = { pass: 0, suppress: 0, rewrite: 0 };
  const suppressSamples: string[] = [];

  for (const row of rows) {
    if (!row.description) continue;
    scanned++;

    const { text, strippedRatio, removedWidget } = sanitizeDescriptionDetailed(
      row.description,
      { town: row.town },
    );
    const { verdict, reasons } = assessDescription(text, row.name, row.venue_name, {
      town: row.town,
      strippedRatio,
    });
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;

    if (verdict === "suppress" && suppressSamples.length < 25) {
      suppressSamples.push(
        `   · "${row.name}" @ ${row.venue_name ?? "?"} — [${reasons.join(", ")}] ` +
          `"${text.slice(0, 70).replace(/\n/g, " ")}…"`,
      );
    }

    const cleanedText = text.length > 0 ? text : null;
    const changed = removedWidget || cleanedText !== row.description;
    if (!changed) continue;
    wouldClean++;

    if (row.description_locked) {
      skippedLocked++;
      continue;
    }

    if (APPLY) {
      const { error: upErr } = await supabaseAdmin
        .from("hwy4_events")
        .update({ description: cleanedText })
        .eq("id", row.id);
      if (upErr) {
        console.error(`  ✗ ${row.id} ${row.name}: ${upErr.message}`);
        continue;
      }
      cleaned++;
    } else if (!REPORT) {
      console.log(
        `  ~ would clean "${row.name}" @ ${row.venue_name ?? "?"} ` +
          `(stripped ${(strippedRatio * 100).toFixed(0)}% of lines)`,
      );
    }
  }

  console.log("\n──────── description sanitize ────────");
  console.log(`scanned (non-null descriptions): ${scanned}`);
  console.log(`needing cleanup:                 ${wouldClean}`);
  console.log(`  locked, skipped:               ${skippedLocked}`);
  console.log(
    `render-gate verdicts:            pass ${verdicts.pass} · ` +
      `suppress ${verdicts.suppress} · rewrite ${verdicts.rewrite}`,
  );
  if (REPORT && suppressSamples.length > 0) {
    console.log(`\nsuppressed at render (sample of ${suppressSamples.length}):`);
    console.log(suppressSamples.join("\n"));
  }
  if (APPLY) console.log(`\n✓ cleaned ${cleaned} rows`);
  else console.log(`\n(dry-run — re-run with --apply to write, --report for stats only)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
