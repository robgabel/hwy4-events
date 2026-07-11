import { supabaseAdmin } from "./lib/supabase-admin.js";
import { selectBlurbBackfill } from "../lib/local-facts.js";

/**
 * One-time backfill of `local_facts` from already-published venue blurbs.
 *
 * The KB capture loop (captureBlurbFact) only fires on a human Save at
 * /admin/venues and shipped 2026-07-01 — every blurb published before then was
 * never recorded, so `local_facts` claims to be authoritative while holding a
 * handful of rows. This inserts one active `kind='blurb'` fact per venue that
 * has a published blurb and no active blurb fact yet, with honest provenance:
 * source='backfill' (not 'blurb_review' — we don't know the save context),
 * confidence='human' (a human published every live blurb; the machine only
 * ever writes blurb_draft), was_edited=null (no draft to compare against).
 *
 * Idempotent: venues with an active blurb fact are skipped, so re-runs are
 * no-ops and it never supersedes anything captureBlurbFact wrote. Reversible:
 * DELETE FROM local_facts WHERE source='backfill'.
 *
 *   cd scripts && npx tsx backfill-local-facts.ts            # preview
 *   cd scripts && npx tsx backfill-local-facts.ts --commit   # apply
 */

async function main() {
  const commit = process.argv.includes("--commit");

  const [venuesRes, factsRes] = await Promise.all([
    supabaseAdmin.from("hwy4_venues").select("venue_key, blurb"),
    supabaseAdmin
      .from("local_facts")
      .select("subject_key")
      .eq("subject_type", "venue")
      .eq("kind", "blurb")
      .eq("status", "active"),
  ]);
  if (venuesRes.error) {
    console.error("Fetch venues failed:", venuesRes.error);
    process.exit(1);
  }
  if (factsRes.error) {
    console.error("Fetch local_facts failed:", factsRes.error);
    process.exit(1);
  }

  const captured = new Set((factsRes.data ?? []).map((f) => f.subject_key as string));
  const candidates = selectBlurbBackfill(venuesRes.data ?? [], captured);

  console.log(
    `${commit ? "APPLY" : "DRY-RUN"}: ${venuesRes.data?.length ?? 0} venues, ` +
      `${captured.size} already captured, ${candidates.length} to backfill\n`,
  );
  for (const c of candidates) console.log(`   ${c.venue_key}`);

  if (candidates.length === 0) {
    console.log("Nothing to backfill — local_facts is already complete.");
    return;
  }
  if (!commit) {
    console.log("\nDry-run only. Re-run with --commit to apply.");
    return;
  }

  const { error } = await supabaseAdmin.from("local_facts").insert(
    candidates.map((c) => ({
      subject_type: "venue",
      subject_key: c.venue_key,
      kind: "blurb",
      fact: c.blurb,
      prior_value: null,
      was_edited: null,
      source: "backfill",
      confidence: "human",
      captured_by: "backfill",
    })),
  );
  if (error) {
    console.error("Insert failed:", error);
    process.exit(1);
  }
  console.log(`\nInserted ${candidates.length} blurb facts. Done.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
