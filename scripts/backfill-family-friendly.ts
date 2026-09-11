import { supabaseAdmin } from "./lib/supabase-admin.js";
import { resolveFamilyFriendly } from "../lib/family-friendly.js";

/**
 * One-time backfill of `hwy4_events.family_friendly` from the shared
 * `resolveFamilyFriendly` predicate (isFamilyFriendly over name+description,
 * or category='kids'). Skips `family_friendly_locked` rows — those are a
 * human pin.
 *
 * The migration already stamps category='kids' rows true in SQL. This pass
 * covers the rest of the catalog with the real JS predicate so SQL regex
 * cannot drift from lib/family-friendly.ts. False beats a wrong true (21+).
 *
 * Dry-run by default; pass --commit to write.
 *
 *   cd scripts && npx tsx backfill-family-friendly.ts            # preview
 *   cd scripts && npx tsx backfill-family-friendly.ts --commit   # apply
 */

interface Row {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  family_friendly: boolean | null;
  family_friendly_locked: boolean | null;
}

const PAGE = 1000;

async function fetchAll(): Promise<Row[]> {
  const all: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("hwy4_events")
      .select(
        "id, name, description, category, family_friendly, family_friendly_locked"
      )
      .eq("family_friendly_locked", false)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Fetch failed:", error);
      process.exit(1);
    }
    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const rows = await fetchAll();
  console.log(
    `${commit ? "APPLY" : "DRY-RUN"}: evaluating ${rows.length} unlocked rows\n`
  );

  const toTrue: Row[] = [];
  const toFalse: Row[] = [];

  for (const r of rows) {
    const next = resolveFamilyFriendly({
      name: r.name,
      description: r.description,
      category: r.category,
    });
    if (next === !!r.family_friendly) continue;
    (next ? toTrue : toFalse).push(r);
  }

  if (toTrue.length > 0) {
    console.log(`→ family_friendly=true, ${toTrue.length}:`);
    for (const r of toTrue) {
      console.log(`   [${r.category}] ${r.name}`);
    }
    console.log();
  }
  if (toFalse.length > 0) {
    console.log(`→ family_friendly=false, ${toFalse.length}:`);
    for (const r of toFalse) {
      console.log(`   [${r.category}] ${r.name}`);
    }
    console.log();
  }
  if (toTrue.length === 0 && toFalse.length === 0) {
    console.log("No changes needed — family_friendly is already up to date.");
    return;
  }

  if (!commit) {
    console.log("Re-run with --commit to write.");
    return;
  }

  const idsTrue = toTrue.map((r) => r.id);
  const idsFalse = toFalse.map((r) => r.id);
  for (let i = 0; i < idsTrue.length; i += 200) {
    const chunk = idsTrue.slice(i, i + 200);
    const { error } = await supabaseAdmin
      .from("hwy4_events")
      .update({ family_friendly: true })
      .in("id", chunk)
      .eq("family_friendly_locked", false);
    if (error) {
      console.error("Update true failed:", error);
      process.exit(1);
    }
  }
  for (let i = 0; i < idsFalse.length; i += 200) {
    const chunk = idsFalse.slice(i, i + 200);
    const { error } = await supabaseAdmin
      .from("hwy4_events")
      .update({ family_friendly: false })
      .in("id", chunk)
      .eq("family_friendly_locked", false);
    if (error) {
      console.error("Update false failed:", error);
      process.exit(1);
    }
  }
  console.log(
    `Wrote family_friendly=true on ${idsTrue.length}, false on ${idsFalse.length}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
