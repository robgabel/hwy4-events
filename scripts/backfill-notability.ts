import { supabaseAdmin } from "./lib/supabase-admin.js";
import { classifyNotabilityDetailed } from "../lib/notability.js";

/**
 * One-time backfill of `is_routine` for the two operational venues.
 *
 * Flips existing "Thursday Night Dinner" / "Sunday Brunch" / "Wednesday Deli
 * Special" rows to is_routine=true so they drop off the public site immediately,
 * without waiting for the next scrape. Uses the SAME deterministic floor the
 * write path uses (lib/notability.ts) — floor-only, no LLM, so it's free and
 * reproducible. Genuine events (live_music, karaoke, car show, "… with Live
 * Music") stay visible via the Tier-0 hook.
 *
 * Scope: org_slug IN (sequoia-woods, moose-lodge) only. Skips notability_locked
 * rows (human overrides). Dry-run by default; pass --commit to write.
 *
 *   cd scripts && npx tsx backfill-notability.ts            # preview
 *   cd scripts && npx tsx backfill-notability.ts --commit   # apply
 */

const OPERATIONAL_ORG_SLUGS = ["sequoia-woods", "moose-lodge"];

interface Row {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  is_weekly: boolean | null;
  is_routine: boolean | null;
  visibility: string | null;
}

async function main() {
  const commit = process.argv.includes("--commit");

  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, description, category, is_weekly, is_routine, visibility")
    .in("org_slug", OPERATIONAL_ORG_SLUGS)
    .eq("notability_locked", false);

  if (error) {
    console.error("Fetch failed:", error);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(
    `${commit ? "APPLY" : "DRY-RUN"}: evaluating ${rows.length} rows across ${OPERATIONAL_ORG_SLUGS.join(", ")}\n`,
  );

  const toRoutine: Row[] = [];
  const toEvent: Row[] = [];

  for (const r of rows) {
    const d = classifyNotabilityDetailed(`${r.name} ${r.description ?? ""}`, {
      category: r.category,
      is_weekly: r.is_weekly ?? undefined,
    });
    if (d.isRoutine !== !!r.is_routine) {
      (d.isRoutine ? toRoutine : toEvent).push(r);
    }
  }

  if (toRoutine.length > 0) {
    console.log(`→ HIDE (is_routine=true), ${toRoutine.length}:`);
    for (const r of toRoutine) console.log(`   [${r.visibility}] ${r.name}`);
    console.log();
  }
  if (toEvent.length > 0) {
    console.log(`→ UNHIDE (is_routine=false), ${toEvent.length}:`);
    for (const r of toEvent) console.log(`   [${r.visibility}] ${r.name}`);
    console.log();
  }
  if (toRoutine.length === 0 && toEvent.length === 0) {
    console.log("No changes needed — is_routine is already up to date.");
    return;
  }

  if (!commit) {
    console.log("Dry-run only. Re-run with --commit to apply.");
    return;
  }

  for (const [value, group] of [
    [true, toRoutine],
    [false, toEvent],
  ] as const) {
    if (group.length === 0) continue;
    const ids = group.map((r) => r.id);
    const { error: updErr } = await supabaseAdmin
      .from("hwy4_events")
      .update({ is_routine: value })
      .in("id", ids);
    if (updErr) console.error(`Update (is_routine=${value}) failed:`, updErr);
    else console.log(`Set is_routine=${value} on ${ids.length} rows.`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
