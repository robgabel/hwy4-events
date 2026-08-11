/**
 * Unpinned-row guard.
 *
 * A row that carries NEITHER a `source_event_id` NOR an `event_url` has no
 * handle back to the listing it came from, and that costs three things at once:
 *
 *  1. **Unverifiable.** Nothing can be re-read to confirm the date/time we
 *     printed. `/api/verify-events` needs a page; there isn't one.
 *  2. **Uncorrectable.** `correctFromUrl` (scripts/lib/url-date.ts) cross-checks
 *     the organizer's own permalink against the extracted date. With no URL it
 *     has nothing to read, so a wrong date stays wrong forever.
 *  3. **Unretractable.** The window-scoped stale sweep (scripts/lib/stale-sweep.ts)
 *     keys a resident row by its sid/URL to decide whether this source still
 *     asserts it. A keyless row can never be swept, so it outlives the listing.
 *
 * That is the exact shape of the Murphys Irish Pub phantom lineup (2026-08-09,
 * LESSONS.md): a Wix homepage with no absolute dates, an LLM that invented them
 * rather than failing, and 36 of 50 upcoming rows that no layer could see,
 * correct, or retract because every one of them was unpinned.
 *
 * **The policy is per-source on purpose — most unpinned rows are legitimate.**
 * Seed scripts (Big Trees programs, the Lube Room chalkboard) and the vision/PDF
 * sources transcribe a schedule that has no per-event page anywhere; those rows
 * are unpinned BY DESIGN and a blanket rule would delete real, hand-curated
 * events. So each caller declares what unpinned means for it:
 *
 *   - `allow`  — unpinned is the expected shape here (seeded/transcribed rows).
 *                Nothing is dropped and the count is reported as 0, because it
 *                is not an anomaly worth a number on an ops dashboard.
 *   - `warn`   — the default. Nothing is dropped, but the count is reported, so
 *                a text-scrape source that starts emitting keyless rows shows up
 *                in the scrape log and in `scrape_runs.source_results`.
 *   - `reject` — unpinned rows are refused at the write boundary.
 *
 * Nothing is set to `reject` yet: the flip is a later, soak-gated change once
 * `warn` has read zero for the text-scrape sources for seven consecutive days.
 *
 * Pure + dependency-free so `scripts/test/unpinned-guard.test.ts` can lock it
 * without the Supabase env dance `dedup.ts` requires.
 */

export type UnpinnedPolicy = "allow" | "warn" | "reject";

/** The two columns that pin a row to the listing it came from. */
export interface PinnableEvent {
  source_event_id?: string | null;
  event_url?: string | null;
}

export interface UnpinnedPartition<T> {
  /** Events that may proceed to the write. */
  kept: T[];
  /** Events refused by the policy (always empty unless policy is "reject"). */
  rejected: T[];
  /**
   * How many unpinned rows this batch carried. Deliberately 0 under "allow" —
   * for those sources an unpinned row is the normal shape, not a signal.
   */
  unpinnedCount: number;
}

/** A field pins the row only when it is a real, non-blank string. */
function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** True when a row carries no handle back to its source listing. */
export function isUnpinned(event: PinnableEvent): boolean {
  return !present(event.source_event_id) && !present(event.event_url);
}

/**
 * Split a batch by the source's unpinned policy. Never mutates its input, and
 * preserves order within `kept` / `rejected` so the caller's logs read in the
 * order the scraper produced them.
 */
export function partitionUnpinned<T extends PinnableEvent>(
  events: readonly T[],
  policy: UnpinnedPolicy
): UnpinnedPartition<T> {
  if (policy === "allow") {
    return { kept: [...events], rejected: [], unpinnedCount: 0 };
  }

  const kept: T[] = [];
  const rejected: T[] = [];
  let unpinnedCount = 0;

  for (const event of events) {
    if (!isUnpinned(event)) {
      kept.push(event);
      continue;
    }
    unpinnedCount++;
    if (policy === "reject") rejected.push(event);
    else kept.push(event);
  }

  return { kept, rejected, unpinnedCount };
}
