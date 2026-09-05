// The persona-QA agent's one write primitive: a field-level fix to a single
// hwy4_events row, filed as a `qa_fix_event` agent_actions proposal and applied
// by the executor only after a human approves it in /admin/actions (propose-first;
// the agent_policy row can graduate it to auto-run after a clean canary).
//
// Pure module — no Supabase client — so scripts/test/qa-fix-event.test.ts can
// lock the whitelist and the lock-respect rules without a network.

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
] as const;

export type QaFixableColumn = (typeof QA_FIXABLE_COLUMNS)[number];

// A human-locked field wins over a QA fix even post-approval: the lock records a
// deliberate hand-curation (see scripts/lib/dedup.ts merge rules), and silently
// overwriting it would reintroduce the exact class of bug the locks exist to stop.
export const LOCK_GUARDS: Partial<Record<QaFixableColumn, string>> = {
  description: "description_locked",
  price: "price_locked",
  image_url: "poster_locked",
};

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
