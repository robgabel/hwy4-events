/**
 * Phase 1 cleanup script (PRD-event-deduplication.md, P1.3).
 *
 * Recomputes dedup_key for every row in hwy4_events using the current
 * formula in scripts/lib/dedup.ts (DEDUP_KEY_VERSION). For each group of
 * rows that now share a key:
 *   1. Pick the winner (most non-null important fields; tie-break = oldest).
 *   2. Smart-merge sibling field data into the winner.
 *   3. Delete the siblings.
 *
 * Usage:
 *   tsx maintenance/rehash-dedup-keys.ts --dry-run    # show planned actions
 *   tsx maintenance/rehash-dedup-keys.ts              # apply (also prompts)
 *
 * The script is idempotent: running it twice on a clean table is a no-op.
 */

import { supabaseAdmin } from "../lib/supabase-admin.js";
import {
  generateDedupKey,
  mergeEventFields,
  DEDUP_KEY_VERSION,
} from "../lib/dedup.js";

const DRY_RUN = process.argv.includes("--dry-run");

interface Row {
  id: string;
  name: string;
  date: string;
  town: string;
  venue_name: string | null;
  address: string | null;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  price: string | null;
  event_url: string | null;
  dedup_key: string | null;
  created_at: string;
  last_scraped_at: string | null;
  source_name: string | null;
}

const RICHNESS_FIELDS: (keyof Row)[] = [
  "venue_name",
  "address",
  "description",
  "start_time",
  "end_time",
  "price",
  "event_url",
];

function isUseful(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== "string") return true;
  const t = value.trim().toLowerCase();
  if (t === "") return false;
  if (t === "unknown venue" || t === "unknown" || t === "tbd") return false;
  return true;
}

function richness(row: Row): number {
  let score = 0;
  for (const f of RICHNESS_FIELDS) {
    if (isUseful(row[f])) score++;
  }
  // Longer description and address contribute a fractional bump so we
  // break ties between rows that have the same field count but one has
  // more data inside.
  if (row.description) score += Math.min(row.description.length, 500) / 1000;
  if (row.address) score += Math.min(row.address.length, 100) / 1000;
  return score;
}

function pickWinner(group: Row[]): Row {
  return [...group].sort((a, b) => {
    const dr = richness(b) - richness(a);
    if (dr !== 0) return dr;
    // Tie-break: oldest created_at wins (we keep the original row id)
    return a.created_at.localeCompare(b.created_at);
  })[0];
}

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("hwy4_events")
      .select(
        "id, name, date, town, venue_name, address, description, start_time, end_time, price, event_url, dedup_key, created_at, last_scraped_at, source_name"
      )
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

interface Plan {
  totalRows: number;
  groupsRekeyed: number;
  groupsCollapsed: number;
  rowsMerged: number;
  rowsDeleted: number;
  actions: PlannedAction[];
}

type PlannedAction =
  | {
      type: "rekey";
      id: string;
      from: string | null;
      to: string;
      fieldUpdates: Partial<Row>;
    }
  | {
      type: "delete";
      id: string;
      reason: string;
      losingTo: string;
    };

function buildPlan(rows: Row[]): Plan {
  const byNewKey = new Map<string, Row[]>();
  for (const row of rows) {
    const newKey = generateDedupKey(
      row.name,
      row.date,
      row.town,
      row.address,
      row.venue_name
    );
    let bucket = byNewKey.get(newKey);
    if (!bucket) {
      bucket = [];
      byNewKey.set(newKey, bucket);
    }
    bucket.push(row);
  }

  const plan: Plan = {
    totalRows: rows.length,
    groupsRekeyed: 0,
    groupsCollapsed: 0,
    rowsMerged: 0,
    rowsDeleted: 0,
    actions: [],
  };

  for (const [newKey, group] of byNewKey) {
    if (group.length === 1) {
      const only = group[0];
      if (only.dedup_key !== newKey) {
        plan.actions.push({
          type: "rekey",
          id: only.id,
          from: only.dedup_key,
          to: newKey,
          fieldUpdates: { dedup_key: newKey },
        });
        plan.groupsRekeyed++;
      }
      continue;
    }

    // Collapse a multi-row group via smart merge.
    const winner = pickWinner(group);
    const losers = group.filter((r) => r.id !== winner.id);

    let merged: Row = { ...winner };
    for (const loser of losers) {
      const { merged: m } = mergeEventFields(merged, loser);
      merged = {
        ...merged,
        name: m.name,
        venue_name: m.venue_name,
        address: m.address,
        description: m.description,
        start_time: m.start_time,
        end_time: m.end_time,
        price: m.price,
        event_url: m.event_url,
      };
    }

    plan.actions.push({
      type: "rekey",
      id: winner.id,
      from: winner.dedup_key,
      to: newKey,
      fieldUpdates: {
        dedup_key: newKey,
        venue_name: merged.venue_name,
        address: merged.address,
        description: merged.description,
        start_time: merged.start_time,
        end_time: merged.end_time,
        price: merged.price,
        event_url: merged.event_url,
      },
    });
    plan.groupsCollapsed++;
    plan.rowsMerged += losers.length;

    for (const loser of losers) {
      plan.actions.push({
        type: "delete",
        id: loser.id,
        reason: "collapsed into richer sibling",
        losingTo: winner.id,
      });
      plan.rowsDeleted++;
    }
  }

  return plan;
}

async function apply(plan: Plan): Promise<void> {
  // Step 1 — null out dedup_key on every row that will be re-keyed or deleted.
  // This avoids transient UNIQUE-violations as we update keys in a different
  // order than the table currently holds them in.
  const touchedIds = new Set<string>();
  for (const action of plan.actions) {
    touchedIds.add(action.id);
  }
  if (touchedIds.size > 0) {
    const ids = Array.from(touchedIds);
    // chunk to keep payloads small
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("hwy4_events")
        .update({ dedup_key: null })
        .in("id", slice);
      if (error) throw error;
    }
  }

  // Step 2 — delete losers (their dedup_key is now null, so unique index
  // won't complain when we set the winner's new key).
  const deletes = plan.actions.filter(
    (a): a is Extract<PlannedAction, { type: "delete" }> => a.type === "delete"
  );
  for (let i = 0; i < deletes.length; i += 200) {
    const slice = deletes.slice(i, i + 200).map((d) => d.id);
    const { error } = await supabaseAdmin
      .from("hwy4_events")
      .delete()
      .in("id", slice);
    if (error) throw error;
  }

  // Step 3 — apply rekey + field updates one row at a time. The volume is
  // small (~600 rows max) so individual updates keep the code simple and
  // make failures easy to localize.
  const rekeys = plan.actions.filter(
    (a): a is Extract<PlannedAction, { type: "rekey" }> => a.type === "rekey"
  );
  for (const r of rekeys) {
    const { error } = await supabaseAdmin
      .from("hwy4_events")
      .update(r.fieldUpdates)
      .eq("id", r.id);
    if (error) {
      console.error(`Failed to rekey ${r.id}:`, error.message);
      throw error;
    }
  }
}

async function main() {
  console.log(
    `=== rehash-dedup-keys (DEDUP_KEY_VERSION=${DEDUP_KEY_VERSION}, dry-run=${DRY_RUN}) ===`
  );

  const rows = await fetchAll();
  console.log(`Loaded ${rows.length} rows from hwy4_events.`);

  const plan = buildPlan(rows);

  console.log("\nPlan summary:");
  console.log(`  Total rows:        ${plan.totalRows}`);
  console.log(`  Groups re-keyed:   ${plan.groupsRekeyed}`);
  console.log(`  Groups collapsed:  ${plan.groupsCollapsed}`);
  console.log(`  Rows merged into a sibling: ${plan.rowsMerged}`);
  console.log(`  Rows to be deleted:         ${plan.rowsDeleted}`);
  console.log(`  Total actions:     ${plan.actions.length}`);

  if (plan.groupsCollapsed > 0) {
    console.log("\nFirst 10 collapse groups (winner ← losers):");
    let shown = 0;
    const grouped = new Map<string, string[]>();
    for (const a of plan.actions) {
      if (a.type === "delete") {
        let arr = grouped.get(a.losingTo);
        if (!arr) {
          arr = [];
          grouped.set(a.losingTo, arr);
        }
        arr.push(a.id);
      }
    }
    for (const [winnerId, losers] of grouped) {
      if (shown >= 10) break;
      const winnerRow = rows.find((r) => r.id === winnerId);
      console.log(
        `  ${winnerRow?.date} | ${winnerRow?.name} | ${winnerRow?.town} (${winnerRow?.venue_name ?? "?"}) — winner ${winnerId} ← ${losers.length} sibling(s)`
      );
      shown++;
    }
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: no changes applied.");
    return;
  }

  if (plan.actions.length === 0) {
    console.log("\nNothing to do. Table is already clean under the current formula.");
    return;
  }

  console.log("\nApplying changes...");
  await apply(plan);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
