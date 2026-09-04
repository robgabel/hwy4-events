import { supabaseAdmin } from "./lib/supabase-admin.js";
import { classifyVisitor, VISITOR_CLASSES, type VisitorClass } from "../lib/geo.js";

/**
 * One-off reclassification of site_events.visitor_class after the 2026-09-04
 * classifier change (lib/geo.ts): a third located class `hub` (regional ISP
 * hub cities, counted apart from local and visitor) and a `localIpCities` list
 * widened to the rest of Calaveras County (Valley Springs read "visitor").
 *
 * Recomputes the class from the geo STORED on each row (country / region /
 * city; site_events keeps no lat/lng) for rows since --since (default
 * 2026-06-08, the first day of tracking) and prints before/after counts.
 * Dry-run by default; pass --apply to write.
 *
 * Rules, stated because they are the honesty of the thing:
 *   - A stored `local` is NEVER demoted to `visitor`. A row can be local via the
 *     bounding box (Pioneer, Tuolumne, Pine Grove read local that way) and the
 *     row carries no coordinates to re-derive that from, so a city-only
 *     recompute would strip a signal it cannot see. Such rows are listed.
 *   - Every other difference is applied: visitor -> local (Valley Springs),
 *     visitor -> hub (Sacramento / Stockton / Lodi / Modesto), local -> hub
 *     (Sonora, which read local via the box until hub cities took precedence).
 *   - `unknown` rows carry no country and stay unknown.
 *   - Bot and outbound rows are reclassified too: the class is a property of
 *     the geo, not of the row's kind, and every consumer filters is_bot itself.
 *
 * Idempotent: a second run reports zero changes. Requires migration
 * 20260904_visitor_class_hub.sql (the CHECK must admit 'hub') before --apply.
 * Also a fork's discovery tool: the dry-run lists the top IP cities per class,
 * which is how you find YOUR region's hub cities for regions/<slug>/core.ts.
 *
 *   cd scripts && npx tsx reclassify-visitor-class.ts                # preview
 *   cd scripts && npx tsx reclassify-visitor-class.ts --apply        # write
 *   cd scripts && npx tsx reclassify-visitor-class.ts --since=2026-07-01
 */

interface Row {
  id: string;
  visitor_class: VisitorClass;
  country: string | null;
  region: string | null;
  city: string | null;
  kind: string;
  is_bot: boolean;
  session_id: string | null;
}

const PAGE = 1000; // PostgREST caps a response at ~1,000 rows; page under it.
const UPDATE_CHUNK = 100; // ids per .in() filter (URL length), well under limits.

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Count rows and distinct human view sessions per class. */
function tally(rows: Row[], cls: (r: Row) => VisitorClass) {
  const out: Record<string, { rows: number; sessions: Set<string> }> = {};
  for (const c of VISITOR_CLASSES) out[c] = { rows: 0, sessions: new Set() };
  for (const r of rows) {
    const c = cls(r);
    if (!out[c]) out[c] = { rows: 0, sessions: new Set() };
    out[c].rows++;
    if (r.kind === "view" && !r.is_bot && r.session_id) out[c].sessions.add(r.session_id);
  }
  return out;
}

function printTally(title: string, t: ReturnType<typeof tally>) {
  console.log(`${title}`);
  console.log(`  ${"class".padEnd(9)} ${"rows".padStart(7)} ${"sessions".padStart(9)}   (sessions = distinct non-bot view session_id)`);
  for (const c of Object.keys(t)) {
    console.log(`  ${c.padEnd(9)} ${String(t[c].rows).padStart(7)} ${String(t[c].sessions.size).padStart(9)}`);
  }
}

function topCities(rows: Row[], n = 8): string {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.country ?? "?"}/${r.region ?? "?"}/${(r.city ?? "").toLowerCase() || "(no city)"}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const since = arg("since") ?? "2026-06-08";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since must be YYYY-MM-DD, got ${since}`);

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("site_events")
      .select("id, visitor_class, country, region, city, kind, is_bot, session_id")
      .gte("created_at", `${since}T00:00:00Z`)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  console.log(`${apply ? "APPLY" : "DRY-RUN"}: ${rows.length} site_events rows since ${since}\n`);

  // The recompute sees only what the row stores: no coordinates, so the box
  // can never fire here. That is why a stored local is never demoted below.
  const recomputed = new Map<string, VisitorClass>();
  const keptBoxLocal: Row[] = [];
  const transitions = new Map<string, Row[]>();
  for (const r of rows) {
    const fresh = classifyVisitor({
      country: r.country,
      region: r.region,
      city: r.city,
      latitude: null,
      longitude: null,
    });
    let next = fresh;
    if (r.visitor_class === "local" && fresh === "visitor") {
      next = "local";
      keptBoxLocal.push(r);
    }
    recomputed.set(r.id, next);
    if (next !== r.visitor_class) {
      const k = `${r.visitor_class} -> ${next}`;
      if (!transitions.has(k)) transitions.set(k, []);
      transitions.get(k)!.push(r);
    }
  }

  printTally("BEFORE (stored):", tally(rows, (r) => r.visitor_class));
  console.log();
  printTally("AFTER (recomputed from stored city/region):", tally(rows, (r) => recomputed.get(r.id)!));
  console.log();

  let changed = 0;
  for (const [k, group] of [...transitions.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sessions = new Set(group.filter((r) => r.kind === "view" && !r.is_bot && r.session_id).map((r) => r.session_id));
    console.log(`  ${k.padEnd(20)} ${String(group.length).padStart(6)} rows ${String(sessions.size).padStart(6)} sessions   top: ${topCities(group)}`);
    changed += group.length;
  }
  if (changed === 0) console.log("  (no changes: every stored class already matches the classifier)");
  if (keptBoxLocal.length > 0) {
    console.log(
      `\n  kept as local (box-only, city in neither list; no coordinates on the row to re-check): ${keptBoxLocal.length} rows   ${topCities(keptBoxLocal, 12)}`,
    );
  }

  if (!apply) {
    console.log(`\nDry-run only. ${changed} rows would change. Re-run with --apply to write.`);
    return;
  }
  if (changed === 0) return;

  // Group ids by their new class and update in chunks.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byNext = new Map<VisitorClass, string[]>();
  for (const [id, next] of recomputed) {
    const r = byId.get(id);
    if (!r || r.visitor_class === next) continue;
    if (!byNext.has(next)) byNext.set(next, []);
    byNext.get(next)!.push(id);
  }
  let written = 0;
  for (const [next, ids] of byNext) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK);
      const { error } = await supabaseAdmin
        .from("site_events")
        .update({ visitor_class: next })
        .in("id", chunk);
      if (error) {
        console.error(`\nUpdate failed while writing '${next}' (${written} rows written so far):`, error.message);
        if (/check constraint/i.test(error.message)) {
          console.error("Hint: apply supabase/migrations/20260904_visitor_class_hub.sql first (the CHECK must admit 'hub').");
        }
        process.exit(1);
      }
      written += chunk.length;
    }
  }
  console.log(`\nApplied: ${written} rows updated. Re-run without --apply to confirm zero remaining changes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
