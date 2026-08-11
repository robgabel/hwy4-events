import { upsertEvents } from "./dedup.js";
import { sweepStaleSourceRows } from "./stale-sweep-exec.js";
import {
  addUpsertResult,
  emptyUpsertResult,
  planUpserts,
  sweepIsAllowed,
  type OrganizerBatch,
  type OrganizerRun,
  type OrganizerWrite,
} from "./organizer-source.js";

/**
 * DB half of the organizer-source spine (see organizer-source.ts for the shape
 * and every rule). Write, then retract, in that order and under one org_slug:
 *
 *  1. Future-only floor, then one `upsertEvents` per visibility group — public
 *     first, empty groups skipped.
 *  2. The source's sweep plan, consulted after the write and executed only when
 *     the write happened.
 *
 * Retraction order is load-bearing. Sweeping first would archive-and-delete
 * rows the upsert is about to refresh, so a live event would churn through
 * hwy4_events_removed_archive and come back with a new id on every run.
 */
export async function writeOrganizerBatch(
  run: OrganizerRun,
  batch: OrganizerBatch
): Promise<OrganizerWrite> {
  const { groups, droppedPast } = planUpserts(batch, run.today);
  if (droppedPast > 0) {
    // Unreachable unless a source's own future filter has a bug — the floor
    // holds the line, but silently swallowing the rows would hide the bug.
    console.warn(
      `  Dropped ${droppedPast} past-dated row(s) at the write boundary — ${run.sourceName}'s own future filter missed them.`
    );
  }

  const upsert = emptyUpsertResult();
  let written = 0;
  for (const group of groups) {
    written += group.events.length;
    addUpsertResult(
      upsert,
      await upsertEvents(
        group.events,
        run.sourceName,
        run.orgSlug,
        run.pageUrl,
        group.visibility
      )
    );
  }

  const plan = batch.planSweep?.() ?? null;
  const swept =
    plan && sweepIsAllowed(groups)
      ? // orgSlug last: the run's declaration is the authority on which org may
        // be retracted, never something a plan could set for itself.
        await sweepStaleSourceRows({ ...plan, orgSlug: run.orgSlug })
      : 0;

  return { upsert, swept, written };
}
