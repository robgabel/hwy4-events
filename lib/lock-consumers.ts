// Registry of hwy4_events `*_locked` consumers (HWY-50).
//
// Seven lock columns are checked by five writers, and the subsets differ for
// real reasons: the sweep deletes rows, the dedup path updates fields, the
// moose PDF route writes its own UPDATE, and Blue Lake Springs only inserts.
// One shared lock list would force a consumer to check a lock it cannot
// violate. The defect was the opposite — only qa-fix-event noticed when the
// set of locks grew (visibility_locked landed in LOCK_GUARDS the same day
// stale-sweep missed it; HWY-49 closed that gap in the sweep itself).
//
// Each consumer keeps its own guards (field → lock column, the LOCK_GUARDS
// shape) and its own acknowledgements (lock column → one-line why). 
// findLockConsumerDrift fails when any registered consumer has neither a guard
// nor an acknowledgement for a live *_locked column. scripts/test/lock-consumers.test.ts
// pins that against repo SQL; scripts/check-qa-schema-drift.ts runs the same
// check on the live table.

import {
  ACKNOWLEDGED_UNGUARDED_LOCKS,
  LOCK_GUARDS,
} from "./agent/qa-fix-event.js";

/** Field name → lock column that protects it. Same shape as LOCK_GUARDS. */
export type LockFieldGuards = Readonly<Record<string, string>>;

/** Lock column → why this consumer deliberately does not guard it. */
export type LockAcknowledgements = Readonly<Record<string, string>>;

export type LockConsumer = {
  id: string;
  /** Repo-relative file the CI pin reads to prove a `guards` claim is real. */
  sourceFile: string;
  guards: LockFieldGuards;
  acknowledged: LockAcknowledgements;
};

/**
 * Stale-sweep protects the whole row, not one column: any of these flags
 * makes isProtectedRow return "locked". The field names record what the lock
 * is about. visibility_locked is guarded here (HWY-49); acknowledging that
 * gap would hide the bug this registry exists to catch.
 */
export const STALE_SWEEP_LOCK_GUARDS = {
  price: "price_locked",
  description: "description_locked",
  image_url: "poster_locked",
  start_time: "times_locked",
  end_time: "times_locked",
  is_routine: "notability_locked",
  family_friendly: "family_friendly_locked",
  visibility: "visibility_locked",
} as const satisfies LockFieldGuards;

/**
 * scripts/lib/dedup.ts update payloads (buildExactMatchUpdate,
 * buildStrongMatchUpdate, rowChanged, familyFriendlyPatch). visibility is
 * INSERT-only on this path, so visibility_locked has nothing to protect.
 */
export const DEDUP_UPDATE_LOCK_GUARDS = {
  description: "description_locked",
  price: "price_locked",
  image_url: "poster_locked",
  start_time: "times_locked",
  end_time: "times_locked",
  is_routine: "notability_locked",
  routine_reason: "notability_locked",
  family_friendly: "family_friendly_locked",
} as const satisfies LockFieldGuards;

export const DEDUP_UPDATE_LOCK_ACKS = {
  visibility_locked:
    "upsertEvents writes visibility on INSERT only. buildExactMatchUpdate and buildStrongMatchUpdate omit it, so a re-scrape cannot flip a human-pinned public/private setting.",
} as const satisfies LockAcknowledgements;

/**
 * /api/scrape-moose-lodge writes its own UPDATE (it does not go through
 * upsertEvents). It never writes image_url, so poster_locked has nothing to
 * protect. The other locks are dropped from the update payload.
 */
export const MOOSE_LODGE_LOCK_GUARDS = {
  description: "description_locked",
  price: "price_locked",
  start_time: "times_locked",
  end_time: "times_locked",
  is_routine: "notability_locked",
  routine_reason: "notability_locked",
  visibility: "visibility_locked",
  family_friendly: "family_friendly_locked",
} as const satisfies LockFieldGuards;

export const MOOSE_LODGE_LOCK_ACKS = {
  poster_locked:
    "The moose-lodge PDF update payload has no image_url, so a pinned poster cannot be overwritten by this writer.",
} as const satisfies LockAcknowledgements;

const BLS_INSERT_ONLY =
  "Insert-only: an existing dedup_key is skipped, so /api/scrape-bls never updates a row and cannot overwrite a locked field.";

export const BLS_LOCK_ACKS = {
  description_locked: BLS_INSERT_ONLY,
  price_locked: BLS_INSERT_ONLY,
  poster_locked: BLS_INSERT_ONLY,
  times_locked: BLS_INSERT_ONLY,
  notability_locked: BLS_INSERT_ONLY,
  visibility_locked: BLS_INSERT_ONLY,
  family_friendly_locked: BLS_INSERT_ONLY,
} as const satisfies LockAcknowledgements;

export const LOCK_CONSUMERS: readonly LockConsumer[] = [
  {
    id: "qa-fix-event",
    sourceFile: "lib/agent/qa-fix-event.ts",
    guards: LOCK_GUARDS,
    acknowledged: ACKNOWLEDGED_UNGUARDED_LOCKS,
  },
  {
    id: "stale-sweep",
    sourceFile: "scripts/lib/stale-sweep.ts",
    guards: STALE_SWEEP_LOCK_GUARDS,
    acknowledged: {},
  },
  {
    id: "dedup-update",
    sourceFile: "scripts/lib/dedup.ts",
    guards: DEDUP_UPDATE_LOCK_GUARDS,
    acknowledged: DEDUP_UPDATE_LOCK_ACKS,
  },
  {
    id: "scrape-moose-lodge",
    sourceFile: "app/api/scrape-moose-lodge/route.ts",
    guards: MOOSE_LODGE_LOCK_GUARDS,
    acknowledged: MOOSE_LODGE_LOCK_ACKS,
  },
  {
    id: "scrape-bls",
    sourceFile: "app/api/scrape-bls/route.ts",
    guards: {},
    acknowledged: BLS_LOCK_ACKS,
  },
];

export function locksGuardedBy(guards: LockFieldGuards): string[] {
  return [...new Set(Object.values(guards))].filter(
    (lock): lock is string => typeof lock === "string" && lock.length > 0
  );
}

export type LockStanceGap = {
  consumer: string;
  lock: string;
};

export type LockConsumerDrift = {
  /** Live lock column this consumer neither guards nor acknowledges. */
  unguarded: LockStanceGap[];
  /** A guard names a lock column the table does not have. */
  missingGuards: LockStanceGap[];
  /** An acknowledgement names a lock column the table does not have. */
  staleAcks: LockStanceGap[];
  /** Acknowledgement reason is missing or whitespace. */
  blankReasons: LockStanceGap[];
  /** The same lock is both guarded and acknowledged. */
  conflicts: LockStanceGap[];
};

export function findLockConsumerDrift(
  liveColumns: readonly string[],
  consumers: readonly LockConsumer[] = LOCK_CONSUMERS
): LockConsumerDrift {
  const liveLocks = [...new Set(liveColumns.filter((c) => c.endsWith("_locked")))].sort();
  const live = new Set(liveLocks);
  const unguarded: LockStanceGap[] = [];
  const missingGuards: LockStanceGap[] = [];
  const staleAcks: LockStanceGap[] = [];
  const blankReasons: LockStanceGap[] = [];
  const conflicts: LockStanceGap[] = [];

  for (const consumer of consumers) {
    const guarded = new Set(locksGuardedBy(consumer.guards));
    for (const lock of guarded) {
      if (lock in consumer.acknowledged) {
        conflicts.push({ consumer: consumer.id, lock });
      }
      if (!live.has(lock)) {
        missingGuards.push({ consumer: consumer.id, lock });
      }
    }
    for (const [lock, reason] of Object.entries(consumer.acknowledged)) {
      if (!reason || !reason.trim()) {
        blankReasons.push({ consumer: consumer.id, lock });
      }
      if (!live.has(lock)) {
        staleAcks.push({ consumer: consumer.id, lock });
      }
    }
    for (const lock of liveLocks) {
      if (!guarded.has(lock) && !(lock in consumer.acknowledged)) {
        unguarded.push({ consumer: consumer.id, lock });
      }
    }
  }

  return { unguarded, missingGuards, staleAcks, blankReasons, conflicts };
}

export function hasLockConsumerDrift(d: LockConsumerDrift): boolean {
  return (
    d.unguarded.length > 0 ||
    d.missingGuards.length > 0 ||
    d.staleAcks.length > 0 ||
    d.blankReasons.length > 0 ||
    d.conflicts.length > 0
  );
}

function formatGaps(gaps: readonly LockStanceGap[]): string {
  return gaps.map((g) => `${g.consumer}:${g.lock}`).join(", ");
}

export function describeLockConsumerDrift(d: LockConsumerDrift): string {
  const parts: string[] = [];
  if (d.unguarded.length) {
    parts.push(
      `${d.unguarded.length} consumer/lock pair(s) have no stance: ${formatGaps(d.unguarded)} — guard the field or acknowledge the lock with a reason`
    );
  }
  if (d.missingGuards.length) {
    parts.push(
      `${d.missingGuards.length} guard(s) name a lock column the table does not have: ${formatGaps(d.missingGuards)}`
    );
  }
  if (d.staleAcks.length) {
    parts.push(
      `${d.staleAcks.length} acknowledgement(s) name a lock column the table does not have: ${formatGaps(d.staleAcks)}`
    );
  }
  if (d.blankReasons.length) {
    parts.push(
      `${d.blankReasons.length} acknowledgement(s) have no reason: ${formatGaps(d.blankReasons)}`
    );
  }
  if (d.conflicts.length) {
    parts.push(
      `${d.conflicts.length} lock(s) are both guarded and acknowledged: ${formatGaps(d.conflicts)}`
    );
  }
  return parts.join(" | ");
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Statements split on semicolons that sit outside parentheses and quotes. */
function sqlStatements(sql: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && sql[i - 1] !== "\\") inSingle = !inSingle;
    if (inSingle) continue;
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      out.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  const tail = sql.slice(start);
  if (tail.trim()) out.push(tail);
  return out;
}

const EVENT_TABLE = /(?:public\.)?hwy4_events\b/i;

/**
 * `*_locked` columns declared on hwy4_events in repo SQL (bootstrap CREATE
 * TABLE plus later ALTER TABLE … ADD COLUMN). A comment that merely names a
 * lock, and a lock on another table (hwy4_venues.places_locked), do not count.
 * This is the offline half of the drift sensor: a PR that adds an eighth
 * lock column fails CI before the migration is applied.
 */
export function hwy4EventLockColumnsFromSql(sql: string): string[] {
  const found = new Set<string>();
  for (const statement of sqlStatements(stripSqlComments(sql))) {
    if (/create\s+table\s+(?:if\s+not\s+exists\s+)?/i.test(statement) && EVENT_TABLE.test(statement)) {
      const create = statement.match(
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?hwy4_events\b/i
      );
      if (!create) continue;
      const body = statement.slice(create.index! + create[0].length);
      for (const match of body.matchAll(/^\s*(\w+_locked)\s+boolean\b/gim)) {
        found.add(match[1].toLowerCase());
      }
      continue;
    }
    if (/alter\s+table\b/i.test(statement) && EVENT_TABLE.test(statement)) {
      const alter = statement.match(
        /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?hwy4_events\b/i
      );
      if (!alter) continue;
      const body = statement.slice(alter.index! + alter[0].length);
      for (const match of body.matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+_locked)\b/gi
      )) {
        found.add(match[1].toLowerCase());
      }
    }
  }
  return [...found].sort();
}
