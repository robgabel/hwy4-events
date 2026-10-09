// The persona-QA agent's one write primitive: a field-level fix to a single
// hwy4_events row, filed as a `qa_fix_event` agent_actions proposal and applied
// by the executor only after a human approves it in /admin/actions (propose-first;
// the agent_policy row can graduate it to auto-run after a clean canary).
//
// Pure module — no Supabase client — so scripts/test/qa-fix-event.test.ts can
// lock the whitelist, the lock-respect rules, and the approve-sets-the-lock
// payload (#366) without a network.

// Columns the QA agent may propose changing. Deliberately excludes identity /
// provenance columns (id, dedup_key, source_*, org_slug, venue_key, created_at,
// community_sourced, robs_pick) and the *_locked flags themselves — a QA fix can
// never unlock a human-locked field or rewrite where a row came from.
export const QA_FIXABLE_COLUMNS = [
  "name",
  "date",
  "start_time",
  "end_time",
  "venue_name",
  "town",
  "address",
  "category",
  "price",
  "cost_tier",
  "event_url",
  "description",
  "image_url",
  "artists",
  "status",
  "visibility",
  "family_friendly",
] as const;

export type QaFixableColumn = (typeof QA_FIXABLE_COLUMNS)[number];

// A human-locked field wins over a QA fix even post-approval: the lock records a
// deliberate hand-curation (see scripts/lib/dedup.ts merge rules), and silently
// overwriting it would reintroduce the exact class of bug the locks exist to stop.
export const LOCK_GUARDS: Partial<Record<QaFixableColumn, string>> = {
  description: "description_locked",
  price: "price_locked",
  image_url: "poster_locked",
  // times_locked covers BOTH clock fields as one unit, exactly as the scrapers
  // treat it: scripts/lib/dedup.ts omits start_time and end_time from the merge
  // payload entirely when it is set ("Times are human-set when locked"). Without
  // these two entries an approved QA fix was the one writer on the corridor that
  // could still overwrite a hand-pinned showtime.
  start_time: "times_locked",
  end_time: "times_locked",
  visibility: "visibility_locked",
  family_friendly: "family_friendly_locked",
};

// Lock flags on hwy4_events that deliberately guard nothing in QA_FIXABLE_COLUMNS.
// Listing one here is a decision, not an oversight — findQaSchemaDrift fails on
// any *_locked column that is neither guarded nor acknowledged, so a newly added
// lock (e.g. HWY-24's visibility_locked) turns the daily check red until someone
// says which QA-fixable column it protects.
export const ACKNOWLEDGED_UNGUARDED_LOCKS: Record<string, string> = {
  notability_locked:
    "guards robs_pick / is_routine, and neither is QA-fixable (robs_pick is Rob's hand-curation).",
};

// --- Schema-drift guard -----------------------------------------------------
//
// QA_FIXABLE_COLUMNS and LOCK_GUARDS are plain strings; nothing in the type
// system or the unit tests ties them to the real hwy4_events table. That gap is
// not hypothetical: this whitelist shipped listing `importance` for seven weeks
// after HWY-19 (migration 20260818_drop_importance_sources.sql) dropped the
// column, and an approved fix touching it would have failed at UPDATE time with
// a raw Postgres error. The tests were green the whole time.
//
// `findQaSchemaDrift` is the pure half of the QA sensor: hand it the live column
// list and it says which names no longer exist. The sibling in
// lib/lock-consumers.ts (`findLockConsumerDrift`) applies the same rule to
// every lock consumer, not only this file. scripts/check-qa-schema-drift.ts
// supplies the live half and fails loud on either kind of drift.

export type QaSchemaDrift = {
  /** Whitelisted fixable columns that no longer exist on the table. */
  missingFixable: string[];
  /** Lock flags a guard points at that no longer exist on the table. */
  missingGuards: string[];
  /** Lock flags the table has that no guard references and nothing acknowledges.
   *  Drift in the other direction: the schema grew a protection the QA agent is
   *  not honoring. */
  unguardedLocks: string[];
};

export function findQaSchemaDrift(liveColumns: readonly string[]): QaSchemaDrift {
  const live = new Set(liveColumns);
  const guards = [...new Set(Object.values(LOCK_GUARDS))].filter(
    (g): g is string => typeof g === "string"
  );
  const guarded = new Set(guards);
  return {
    missingFixable: QA_FIXABLE_COLUMNS.filter((c) => !live.has(c)),
    missingGuards: guards.filter((g) => !live.has(g)),
    unguardedLocks: liveColumns
      .filter((c) => c.endsWith("_locked"))
      .filter((c) => !guarded.has(c) && !(c in ACKNOWLEDGED_UNGUARDED_LOCKS))
      .sort(),
  };
}

export function hasQaSchemaDrift(d: QaSchemaDrift): boolean {
  return (
    d.missingFixable.length > 0 ||
    d.missingGuards.length > 0 ||
    d.unguardedLocks.length > 0
  );
}

export function describeQaSchemaDrift(d: QaSchemaDrift): string {
  const parts: string[] = [];
  if (d.missingFixable.length) {
    parts.push(
      `QA_FIXABLE_COLUMNS names ${d.missingFixable.length} column(s) hwy4_events no longer has: ${d.missingFixable.join(", ")}`
    );
  }
  if (d.missingGuards.length) {
    parts.push(
      `LOCK_GUARDS points at ${d.missingGuards.length} missing lock flag(s): ${d.missingGuards.join(", ")}`
    );
  }
  if (d.unguardedLocks.length) {
    parts.push(
      `hwy4_events has ${d.unguardedLocks.length} lock flag(s) no QA guard honors: ${d.unguardedLocks.join(", ")} — add a LOCK_GUARDS entry or acknowledge it in ACKNOWLEDGED_UNGUARDED_LOCKS`
    );
  }
  return parts.join(" | ");
}

export type QaFixEventPayload = {
  event_id?: string;
  updates?: Record<string, unknown>;
  reason?: string;
};

export type QaFixValidation =
  | { ok: true; eventId: string; updates: Record<string, unknown>; columns: QaFixableColumn[] }
  | { ok: false; error: string };

export function validateQaFixPayload(p: QaFixEventPayload): QaFixValidation {
  const eventId = (p.event_id ?? "").trim();
  if (!eventId) return { ok: false, error: "Missing event_id." };

  const updates = p.updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return { ok: false, error: "Missing updates object." };
  }
  const columns = Object.keys(updates);
  if (columns.length === 0) return { ok: false, error: "Empty updates — nothing to fix." };

  const disallowed = columns.filter(
    (c) => !(QA_FIXABLE_COLUMNS as readonly string[]).includes(c)
  );
  if (disallowed.length) {
    return {
      ok: false,
      error: `Column(s) not QA-fixable: ${disallowed.join(", ")}. Allowed: ${QA_FIXABLE_COLUMNS.join(", ")}.`,
    };
  }

  if (!(p.reason ?? "").trim()) {
    return { ok: false, error: "Missing reason — every QA fix must say what was wrong." };
  }

  return {
    ok: true,
    eventId,
    updates: updates as Record<string, unknown>,
    columns: columns as QaFixableColumn[],
  };
}

/** Columns whose lock flag must be checked before applying these updates. */
export function lockColumnsFor(columns: readonly string[]): string[] {
  const guards = new Set<string>();
  for (const c of columns) {
    const guard = LOCK_GUARDS[c as QaFixableColumn];
    if (guard) guards.add(guard);
  }
  return [...guards];
}

/** Given the current row (updates' columns + lock flags), return the columns
 *  whose lock flag is set — the executor refuses the fix if any are locked. */
export function lockedViolations(
  row: Record<string, unknown>,
  columns: readonly string[]
): string[] {
  return columns.filter((c) => {
    const guard = LOCK_GUARDS[c as QaFixableColumn];
    return guard ? row[guard] === true : false;
  });
}

// Snapshot key on agent_actions.before_snapshot. It is not a hwy4_events
// column. Revert reads it to clear only the locks this approval turned on,
// then strips it before the UPDATE.
export const QA_FIX_LOCKS_SET_KEY = "__locks_set";

const KNOWN_LOCKS = new Set(
  Object.values(LOCK_GUARDS).filter((lock): lock is string => typeof lock === "string")
);

/**
 * Columns with no LOCK_GUARDS entry (name, date, venue_name, town, address,
 * category, cost_tier, event_url, artists, status, and the rest of
 * QA_FIXABLE_COLUMNS) have no *_locked column. An approved fix writes them,
 * and a later scrape can still overwrite them. cost_tier is covered only when
 * price is locked too: /api/extract-prices skips price_locked rows, and the
 * scrapers do not write cost_tier.
 */
export function qaFixWritePayload(updates: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...updates };
  for (const lock of lockColumnsFor(Object.keys(updates))) {
    payload[lock] = true;
  }
  return payload;
}

/** Locks this approval will flip from unset to set. A flag already true was
 *  set by a person (or an earlier approval) and must not be listed, or revert
 *  would clear it. */
export function locksTurnedOn(
  row: Record<string, unknown>,
  columns: readonly string[]
): string[] {
  return lockColumnsFor(columns)
    .filter((lock) => row[lock] !== true)
    .sort();
}

export function qaFixBeforeSnapshot(
  row: Record<string, unknown>,
  columns: readonly string[]
): Record<string, unknown> {
  const beforeSnapshot: Record<string, unknown> = {};
  for (const c of columns) beforeSnapshot[c] = row[c] ?? null;
  const locks = locksTurnedOn(row, columns);
  if (locks.length > 0) beforeSnapshot[QA_FIX_LOCKS_SET_KEY] = locks;
  return beforeSnapshot;
}

/** True when the snapshot holds at least one restored column. A snapshot that
 *  is only `__locks_set` has nothing to put back. */
export function qaFixSnapshotRestores(snap: Record<string, unknown>): boolean {
  return Object.keys(snap).some((key) => key !== QA_FIX_LOCKS_SET_KEY);
}

/** Field values from the snapshot, plus `false` on each lock this approval
 *  turned on. `__locks_set` itself is never sent to hwy4_events. */
export function qaFixRevertPayload(snap: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snap)) {
    if (key === QA_FIX_LOCKS_SET_KEY) continue;
    payload[key] = value;
  }
  const locks = snap[QA_FIX_LOCKS_SET_KEY];
  if (Array.isArray(locks)) {
    for (const lock of locks) {
      if (typeof lock === "string" && KNOWN_LOCKS.has(lock)) payload[lock] = false;
    }
  }
  return payload;
}
