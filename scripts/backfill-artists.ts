/**
 * One-time cleanup for artist coverage + accuracy (2026-10-04). Two passes,
 * both dry-run unless --apply:
 *
 * 1. EVENTS. Fill an empty `artists` from the title when it names the act
 *    ("Live Music - Carlos Castillo"), and tidy existing lists (one entry per
 *    act, compound billings kept whole, so "Alison Krauss" / "Union Station" /
 *    "Alison Krauss & Union Station" becomes the compound alone). New scrapes
 *    do both at the write boundary (scripts/lib/dedup.ts); this reaches rows
 *    no scraper will touch again. Never overwrites a non-empty list with a
 *    title guess; extractActFromTitle refuses anything ambiguous.
 *
 * 2. CATALOG (--catalog). Where several hwy4_artists rows are one act
 *    (lib/artist-identity.ts), a pending draft on a variant is superseded:
 *    by the published variant when there is one, else by the strongest draft
 *    (confidence, then source count). Superseded rows keep blurb_draft_at and
 *    move the old draft into blurb_draft_meta.prior_draft with superseded_by,
 *    so /admin/artists stops asking you to review the same band twice.
 *    Reverse one: UPDATE hwy4_artists SET blurb_draft = blurb_draft_meta->>'prior_draft'
 *    WHERE artist_key = '…';
 *
 *   cd scripts && npx tsx backfill-artists.ts                   # events, future, dry-run
 *   npx tsx backfill-artists.ts --all                           # include past rows
 *   npx tsx backfill-artists.ts --catalog                       # + catalog pass
 *   npx tsx backfill-artists.ts --all --catalog --apply
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { extractActFromTitle } from "../lib/event-identity.js";
import { artistIdentityKey, tidyArtistList } from "../lib/artist-identity.js";

const APPLY = process.argv.includes("--apply");
const ALL_DATES = process.argv.includes("--all");
const CATALOG = process.argv.includes("--catalog");

type EventRow = { id: string; name: string; venue_name: string | null; date: string; artists: string[] | null };

function sameList(a: string[] | null, b: string[] | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function fetchEvents(): Promise<EventRow[]> {
  const out: EventRow[] = [];
  const today = new Date().toISOString().split("T")[0];
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin
      .from("hwy4_events")
      .select("id, name, venue_name, date, artists")
      .order("id")
      .range(from, from + 999);
    if (!ALL_DATES) q = q.gte("date", today);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function eventsPass() {
  const rows = await fetchEvents();
  let filled = 0;
  let tidied = 0;
  let errors = 0;
  for (const row of rows) {
    const current = row.artists && row.artists.length > 0 ? row.artists : null;
    let next: string[] | null;
    let kind: "fill" | "tidy";
    if (!current) {
      const act = extractActFromTitle(row.name, row.venue_name);
      if (!act) continue;
      next = [act];
      kind = "fill";
    } else {
      next = tidyArtistList(current);
      if (!next || sameList(current, next)) continue;
      kind = "tidy";
    }
    console.log(
      `  ${kind === "fill" ? "FILL" : "TIDY"} ${row.date} "${row.name}" ` +
        `${JSON.stringify(current)} -> ${JSON.stringify(next)}`
    );
    if (kind === "fill") filled++;
    else tidied++;
    if (APPLY) {
      const { error } = await supabaseAdmin.from("hwy4_events").update({ artists: next }).eq("id", row.id);
      if (error) {
        errors++;
        console.error(`    ! ${error.message}`);
      }
    }
  }
  console.log(
    `\nEvents: scanned ${rows.length}, ${filled} filled from title, ${tidied} tidied` +
      (APPLY ? `, ${errors} errors` : " (dry-run)")
  );
}

type ArtistRow = {
  artist_key: string;
  name: string;
  blurb: string | null;
  blurb_draft: string | null;
  blurb_draft_meta: Record<string, unknown> | null;
};

const CONF_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function draftStrength(r: ArtistRow): number {
  const m = r.blurb_draft_meta ?? {};
  const conf = CONF_RANK[String(m.confidence ?? "")] ?? 0;
  const sources = Array.isArray(m.sources) ? m.sources.length : 0;
  return conf * 10 + sources;
}

async function catalogPass() {
  const { data, error } = await supabaseAdmin
    .from("hwy4_artists")
    .select("artist_key, name, blurb, blurb_draft, blurb_draft_meta");
  if (error) throw error;
  const groups = new Map<string, ArtistRow[]>();
  for (const r of (data ?? []) as ArtistRow[]) {
    const key = artistIdentityKey(r.name || r.artist_key);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  let superseded = 0;
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    console.log(`  GROUP ${rows.map((r) => `"${r.name}"${r.blurb ? " [published]" : r.blurb_draft ? " [draft]" : ""}`).join(", ")}`);
    const keeper =
      rows.find((r) => r.blurb && r.blurb.trim()) ??
      [...rows].filter((r) => r.blurb_draft).sort((a, b) => draftStrength(b) - draftStrength(a))[0];
    if (!keeper) continue;
    for (const r of rows) {
      if (r === keeper || !r.blurb_draft || (r.blurb && r.blurb.trim())) continue;
      superseded++;
      console.log(`    SUPERSEDE draft on "${r.name}" (kept "${keeper.name}")`);
      if (APPLY) {
        const { error: upErr } = await supabaseAdmin
          .from("hwy4_artists")
          .update({
            blurb_draft: null,
            blurb_draft_meta: {
              ...(r.blurb_draft_meta ?? {}),
              prior_draft: r.blurb_draft,
              superseded_by: keeper.artist_key,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("artist_key", r.artist_key);
        if (upErr) console.error(`    ! ${upErr.message}`);
      }
    }
  }
  console.log(`\nCatalog: ${superseded} variant drafts superseded${APPLY ? "" : " (dry-run)"}`);
}

async function main() {
  console.log(`backfill-artists ${APPLY ? "APPLY" : "dry-run"}${ALL_DATES ? " --all" : ""}${CATALOG ? " --catalog" : ""}\n`);
  await eventsPass();
  if (CATALOG) await catalogPass();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
