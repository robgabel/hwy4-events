/**
 * QA whitelist + lock-consumer schema drift check.
 *
 * `lib/agent/qa-fix-event.ts` decides which hwy4_events columns the persona-QA
 * agent may propose changing. `lib/lock-consumers.ts` records, for each of the
 * five `*_locked` consumers, whether that lock guards a field or is
 * acknowledged. Both are plain strings — the unit tests can assert their shape
 * but not the live table, so a column dropped by a migration (or an eighth
 * lock added in the dashboard) leaves them green and wrong until this job
 * reads prod.
 *
 * That is exactly what happened: HWY-19 dropped `importance` on 2026-08-18 while
 * PR #221 sat open, and the stale whitelist merged seven weeks later with 647
 * passing tests. A sensor that can fail silently is not a sensor (HWY-18), so
 * this one exits non-zero AND posts to Slack.
 *
 * Usage:
 *   npx tsx check-qa-schema-drift.ts              # fail (exit 1) on drift
 *   npx tsx check-qa-schema-drift.ts --warn-only  # report, exit 0
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import {
  QA_FIXABLE_COLUMNS,
  findQaSchemaDrift,
  hasQaSchemaDrift,
  describeQaSchemaDrift,
} from "../lib/agent/qa-fix-event.js";
import {
  LOCK_CONSUMERS,
  findLockConsumerDrift,
  hasLockConsumerDrift,
  describeLockConsumerDrift,
} from "../lib/lock-consumers.js";

const warnOnly = process.argv.includes("--warn-only");

/** Best-effort Slack post; mirrors the per-caller helper pattern in scripts/lib. */
async function postSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error("Slack alert failed:", err);
  }
}

async function liveEventColumns(): Promise<string[]> {
  // information_schema is not exposed through PostgREST, so read one row and
  // take its keys. A live row is the same source of truth the executor writes
  // through, which is the thing we actually care about matching.
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not read hwy4_events: ${error.message}`);
  if (!data) throw new Error("hwy4_events returned no rows — cannot infer columns.");
  return Object.keys(data);
}

async function main() {
  const live = await liveEventColumns();
  const qaDrift = findQaSchemaDrift(live);
  const lockDrift = findLockConsumerDrift(live);

  console.log(`hwy4_events live columns: ${live.length}`);
  console.log(`QA-fixable whitelist:     ${QA_FIXABLE_COLUMNS.length}`);
  console.log(`Lock consumers:           ${LOCK_CONSUMERS.length}`);

  if (!hasQaSchemaDrift(qaDrift) && !hasLockConsumerDrift(lockDrift)) {
    console.log(
      "✓ No drift — every whitelisted column exists and every lock consumer has a stance on every live *_locked column."
    );
    return;
  }

  const detail = [describeQaSchemaDrift(qaDrift), describeLockConsumerDrift(lockDrift)]
    .filter(Boolean)
    .join(" | ");
  console.error(`✗ SCHEMA DRIFT: ${detail}`);
  console.error(
    "Fix lib/agent/qa-fix-event.ts and lib/lock-consumers.ts — a new *_locked column needs a guard or an acknowledgement on every consumer, and a QA fix touching a dropped column fails at UPDATE time."
  );

  await postSlack(
    `:rotating_light: *Lock / QA schema drift* — ${detail}\n` +
      "Every `*_locked` consumer in `lib/lock-consumers.ts` must guard the field or acknowledge the lock, and `lib/agent/qa-fix-event.ts` must only name columns that still exist."
  );

  if (!warnOnly) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("check-qa-schema-drift failed:", err);
  await postSlack(`:rotating_light: *QA schema-drift check errored* — ${String(err)}`);
  process.exitCode = 1;
});
