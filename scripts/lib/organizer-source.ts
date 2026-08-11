import type { ExtractedEvent } from "./extract.js";
import type { UpsertResult } from "./dedup.js";
import type { UnpinnedPolicy } from "./unpinned-guard.js";
import type { SweepRow, SweepWindow } from "./stale-sweep.js";
import { applyVenueDetection } from "./venue-matcher.js";
import { isManuallyManagedEvent } from "./manual-sources.js";

/**
 * Organizer-source skeleton (HWY-20b, 2026-08-11).
 *
 * Four scrapers now read an organizer's own structured data — brice-station
 * (Shopify products.json), arnold-rim-trail (Tribe REST), sequoia-woods (Duda
 * base64 day cells), murphys-irish-pub (Wix per-event JSON-LD) — and all four
 * had hand-rolled the identical spine around their genuinely-bespoke parsing:
 *
 *     fetch + parse  ->  venue detection  ->  future filter  ->  upsertEvents
 *                    ->  window-scoped stale sweep  ->  summary
 *
 * Four copies of a pipeline is four chances for the next organizer source to
 * forget a guardrail, and the HWY-20 audit found exactly that: the central
 * blocklist (`isManuallyManagedEvent`) is called by the three aggregators and
 * by NONE of these four, so an organizer feed that happened to list an event at
 * a hand-curated venue could quietly overwrite a seeded row. This module owns
 * the spine so a new organizer source is a parser plus a config.
 *
 * WHAT THE SKELETON OWNS
 *  - `applyVenueDetection` over every mapped row (registry canonical name +
 *    street address), counted in the log.
 *  - The **blocklist**, ownership-aware: `isManuallyManagedEvent(e, orgSlug)`
 *    with the source's OWN slug, so a source that legitimately owns some
 *    blocklisted rows (arnold-rim-trail owns its five patterns) writes them
 *    freely while every other blocklisted venue stays protected from it.
 *    ALWAYS called as `.filter((e) => isManuallyManagedEvent(e, slug))` —
 *    passing the bare function reference to `.filter` feeds it the array INDEX
 *    as `askingOrgSlug`, which silently blocks the owner's own rows. That
 *    footgun is documented in CLAUDE.md and locked by
 *    `scripts/test/organizer-source.test.ts`.
 *  - The future filter (`date >= today`, UTC, computed once per run).
 *  - The `upsertEvents` call(s) — one per batch so a source with two audiences
 *    (sequoia-woods: public dining/music vs members-only club competitions)
 *    writes each visibility through the shared path — passing through the
 *    source's `unpinnedPolicy`.
 *  - The stale sweep, invoked AFTER every upsert has landed, so the batch the
 *    sweep compares against is the batch that was actually written.
 *  - A consistent summary: inserted / updated / unchanged / merged / unpinned /
 *    swept, plus whatever extra lines the source wants to add.
 *
 * WHAT THE SOURCE KEEPS
 * Everything that is actually about that organizer: the transport, the parsing,
 * the classification, and the sweep's per-source rules (which windows the run
 * provably covered, which identity keys count as present, which resident rows
 * this source owns). Those live in the source's `harvest` and `planSweep`, not
 * here — a shared skeleton must never guess at a venue's calendar semantics.
 *
 * NOT FOR SEED SCRIPTS. The hand-curated seeds (`seed-lube-room-summer-2026`,
 * `seed-bigtrees-programs-2026`, …) call `upsertEvents` directly and never
 * enter this skeleton, by design: their venues are on the blocklist with no
 * `owner`, so routing them through here would block them from their own rows,
 * and their transcribed schedules are deliberately unpinned + deliberately
 * un-sweepable. They stay direct callers.
 *
 * The DB-touching halves (`upsertEvents`, `sweepStaleSourceRows`) are imported
 * lazily so this module — and its test — load without the Supabase env, the
 * same pure/exec split `stale-sweep.ts` / `stale-sweep-exec.ts` uses.
 */

/**
 * One upsert batch. The shared write path stamps a single visibility per call,
 * so a source whose calendar mixes audiences returns one batch per audience.
 */
export interface OrganizerBatch {
  events: ExtractedEvent[];
  /** Defaults to "public" — members-only sources pass "private". */
  visibility?: "public" | "private";
  /** Log label; defaults to the visibility. */
  label?: string;
}

/** What a source's fetch + parse stage hands back. */
export interface OrganizerHarvest<TCtx = undefined> {
  /** Mapped events, grouped by the visibility they must be written under. */
  batches: OrganizerBatch[];
  /** Whatever `planSweep` needs from the fetch stage (parsed months, link list, …). */
  context: TCtx;
  /** Extra source-specific lines for the summary block (fetch counts, etc.). */
  summaryLines?: string[];
}

/** The per-source half of a window-scoped stale sweep (see stale-sweep.ts). */
export interface SweepPlan {
  /** Stored on the archive rows — say which sweep and why. */
  reason: string;
  windows: SweepWindow[];
  presentKeys: Set<string>;
  keysOf: (row: SweepRow) => (string | null | undefined)[];
  ownRow?: (row: SweepRow) => boolean;
}

export interface OrganizerRun<TCtx> {
  /** UTC YYYY-MM-DD, computed once so every stage agrees on "today". */
  today: string;
  context: TCtx;
  /** Exactly the rows that were written this run (post future filter + blocklist). */
  written: ExtractedEvent[];
}

export interface OrganizerSource<TCtx = undefined> {
  sourceName: string;
  orgSlug: string;
  /** The source page recorded on every row (`source_url`). */
  pageUrl: string;
  /** Console banner; defaults to `sourceName`. */
  banner?: string;
  /** See scripts/lib/unpinned-guard.ts. Defaults to the shared "warn". */
  unpinnedPolicy?: UnpinnedPolicy;
  /**
   * Fetch + parse. Returns `null` when the run produced nothing trustworthy —
   * the stage logs its own reason, and the skeleton then writes nothing and
   * sweeps nothing (a failed fetch must never look like an empty calendar).
   */
  harvest: (run: { today: string }) => Promise<OrganizerHarvest<TCtx> | null>;
  /**
   * Optional source-specific scope rule, applied per batch AFTER venue
   * detection and BEFORE the future filter. This is the one slot that has to
   * sit between those two steps: a rule keyed on the venue or town only holds
   * once the registry has canonicalised them (arnold-rim-trail's corridor-town
   * allowlist is the live user). The source logs its own drops.
   */
  refine?: (events: ExtractedEvent[]) => ExtractedEvent[];
  /**
   * Optional retraction. Return `null` to skip the sweep this run (the planner
   * logs its own reason — a truncated list, too few parsed events, …).
   */
  planSweep?: (run: OrganizerRun<TCtx>) => SweepPlan | null;
}

/** The two DB-touching calls, injectable so the test can stub them. */
export interface OrganizerRunDeps {
  upsert: (
    events: ExtractedEvent[],
    sourceName: string,
    orgSlug: string,
    sourceUrl: string,
    visibility?: "public" | "private",
    unpinnedPolicy?: UnpinnedPolicy
  ) => Promise<UpsertResult>;
  sweep: (
    opts: SweepPlan & { orgSlug: string }
  ) => Promise<number>;
}

export interface PreparedBatch {
  visibility: "public" | "private";
  label: string;
  events: ExtractedEvent[];
}

export interface PreparedBatches {
  batches: PreparedBatch[];
  /** Flat view of everything that will be written, in batch order. */
  writable: ExtractedEvent[];
  /** How many rows venue detection rewrote. */
  venueResolved: number;
  /** Rows dropped because their date is already past. */
  past: number;
  /** Rows dropped because another source owns that venue/name. */
  blocked: ExtractedEvent[];
}

export function emptyUpsertResult(): UpsertResult {
  return { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0 };
}

export function addUpsertResult(total: UpsertResult, r: UpsertResult): void {
  total.inserted += r.inserted;
  total.updated += r.updated;
  total.unchanged += r.unchanged;
  total.skippedFuzzy += r.skippedFuzzy;
  total.unpinned += r.unpinned;
}

/**
 * The skeleton's pure decisions, in order: venue detection (mutates each row in
 * place, exactly as every scraper did by hand), the source's optional scope
 * rule, then the future filter, then the ownership-aware blocklist.
 *
 * Venue detection runs FIRST because the blocklist matches on `venue_name`: a
 * feed that writes "Big Tree State Park" only becomes recognisable as the
 * blocklisted "Calaveras Big Trees State Park" after the registry canonicalises
 * it. Doing it the other way round would let a misspelling walk past the guard.
 *
 * It also runs EXACTLY ONCE per row. `applyVenueDetection` is not idempotent
 * for every registry entry (verified 2026-08-11: a "New Melones" row resolves
 * to "New Melones Lake" on the first pass and then to "New Melones Lake Marina"
 * on a second, because the canonical of one venue contains an alias of
 * another), so a scraper must never call it again on its own.
 */
export function prepareBatches(
  batches: OrganizerBatch[],
  opts: {
    today: string;
    orgSlug: string;
    refine?: (events: ExtractedEvent[]) => ExtractedEvent[];
  }
): PreparedBatches {
  const prepared: PreparedBatch[] = [];
  const blocked: ExtractedEvent[] = [];
  let venueResolved = 0;
  let past = 0;

  for (const batch of batches) {
    const visibility = batch.visibility ?? "public";
    for (const e of batch.events) {
      if (applyVenueDetection(e)) venueResolved++;
    }
    const inScope = opts.refine ? opts.refine(batch.events) : batch.events;
    const future = inScope.filter((e) => {
      const keep = e.date >= opts.today;
      if (!keep) past++;
      return keep;
    });
    // ALWAYS an arrow wrapper with an explicit slug — `.filter(isManuallyManagedEvent)`
    // would pass the array index as `askingOrgSlug`. See the module header.
    const writable = future.filter((e) => {
      const isBlocked = isManuallyManagedEvent(e, opts.orgSlug);
      if (isBlocked) blocked.push(e);
      return !isBlocked;
    });
    prepared.push({
      visibility,
      label: batch.label ?? (visibility === "private" ? "members-only" : "public"),
      events: writable,
    });
  }

  return {
    batches: prepared,
    writable: prepared.flatMap((b) => b.events),
    venueResolved,
    past,
    blocked,
  };
}

function previewLine(e: ExtractedEvent, tag: string | null): string {
  const times = `${e.start_time ?? "??:??"}${e.end_time ? `–${e.end_time}` : ""}`;
  const where = [e.venue_name, e.town].filter(Boolean).join(", ");
  return [
    `  - ${e.date} ${times}`,
    ...(tag ? [tag] : []),
    e.category.padEnd(10),
    e.name,
    where,
    ...(e.price ? [e.price] : []),
  ].join(" | ");
}

async function loadDeps(): Promise<OrganizerRunDeps> {
  const [dedup, sweepExec] = await Promise.all([
    import("./dedup.js"),
    import("./stale-sweep-exec.js"),
  ]);
  return { upsert: dedup.upsertEvents, sweep: sweepExec.sweepStaleSourceRows };
}

/**
 * Run one organizer source end to end. Every stage is logged, and a stage that
 * declines to produce data (a failed fetch, a truncated list) short-circuits
 * the write AND the sweep rather than being read as an empty calendar.
 */
export async function runOrganizerSource<TCtx>(
  source: OrganizerSource<TCtx>,
  injected?: OrganizerRunDeps
): Promise<void> {
  const banner = source.banner ?? source.sourceName;
  console.log(`=== ${banner} ===`);

  const today = new Date().toISOString().slice(0, 10);
  const harvest = await source.harvest({ today });
  if (!harvest) return; // the stage logged why; write nothing, sweep nothing.

  const prepared = prepareBatches(harvest.batches, {
    today,
    orgSlug: source.orgSlug,
    refine: source.refine,
  });

  if (prepared.venueResolved > 0) {
    const total = harvest.batches.reduce((n, b) => n + b.events.length, 0);
    console.log(`  Venue detection: resolved ${prepared.venueResolved}/${total} venues`);
  }
  if (prepared.past > 0) {
    console.log(`  Skipped ${prepared.past} past event(s)`);
  }
  if (prepared.blocked.length > 0) {
    console.log(
      `  Skipping ${prepared.blocked.length} manually-managed event(s): ` +
        prepared.blocked.map((e) => `${e.name} @ ${e.venue_name}`).join(", ")
    );
  }

  // Tag each preview line with its audience only when this source has more than
  // one — a single-audience scraper's log shouldn't carry a constant column.
  const tagged = prepared.batches.length > 1;
  for (const batch of prepared.batches) {
    for (const e of batch.events) {
      console.log(previewLine(e, tagged ? batch.label.padEnd(12) : null));
    }
  }
  if (prepared.writable.length === 0) {
    console.log("No future events to upsert.");
  }

  const deps = injected ?? (await loadDeps());
  const totals = emptyUpsertResult();
  for (const batch of prepared.batches) {
    if (batch.events.length === 0) continue;
    const r = await deps.upsert(
      batch.events,
      source.sourceName,
      source.orgSlug,
      source.pageUrl,
      batch.visibility,
      source.unpinnedPolicy
    );
    addUpsertResult(totals, r);
  }

  // Retraction runs AFTER the writes: the sweep asks "what does this source no
  // longer assert", and the answer must be measured against rows already saved.
  let swept = 0;
  if (source.planSweep) {
    const plan = source.planSweep({ today, context: harvest.context, written: prepared.writable });
    if (plan) swept = await deps.sweep({ ...plan, orgSlug: source.orgSlug });
  }

  console.log(`\n=== ${banner} Summary ===`);
  for (const line of harvest.summaryLines ?? []) console.log(line);
  if (prepared.batches.length > 1) {
    console.log(
      `Batches: ${prepared.batches.map((b) => `${b.label} ${b.events.length}`).join(", ")}`
    );
  }
  console.log(`Events written: ${prepared.writable.length}`);
  console.log(`Inserted: ${totals.inserted}`);
  console.log(`Updated: ${totals.updated}`);
  console.log(`Unchanged: ${totals.unchanged}`);
  console.log(`Merged (cross-source): ${totals.skippedFuzzy}`);
  console.log(`Unpinned: ${totals.unpinned}`);
  if (source.planSweep) console.log(`Swept stale: ${swept}`);
}
