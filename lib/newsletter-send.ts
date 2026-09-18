// Durable, idempotent newsletter delivery: a per-recipient send ledger
// (newsletter_send_log) over the Resend Batch API transport.
//
// Origin: reconciles three converging efforts (HANDOFF-newsletter-reconcile.md).
// The ledger design and the pure mapping helpers are adopted from Peter
// Hollens's Eugene fork (eugene/codex/eugene-bootstrap: lib/newsletter-send.ts
// + the newsletter_send_log migration); the Batch API transport and the in-run
// retry pass come from this repo's #142/#146 send hardening.
//
// The contract: before a batch is attempted, its recipients are written to the
// ledger as `pending`; every Resend result is then mapped back to its recipient
// and upserted over that row (UNIQUE(campaign_id, email)). Re-running a send
// therefore skips everyone already `sent` — re-blasting is structurally
// impossible, and "recovery" is just running the send again. `pending` rows
// left by a crashed run also block resend (we cannot know whether Resend
// delivered) and are surfaced for manual remediation instead of risking a
// double send. `failed` rows are retried on the next run.
//
// Pure helpers (chunk / selectSubscribersForSend / mapBatchSendResult /
// batchRecipientHash / resendErrorMessage / rankSubscribersForSend /
// applyDailySendBudget / shouldMarkDraftSent / pickCampaignDraft) are locked
// by scripts/test/newsletter-send.test.ts.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";
import type { CreateBatchEmailOptions } from "resend";

export const NEWSLETTER_BATCH_SIZE = 100;

/** Per-run campaign send cap (HWY-44). Resend's team free tier is 100 emails/day
 *  and confirm / reminder / test sends share it, so a Thursday blast of the
 *  ~110-person list overflowed. 85 leaves ~15 headroom. Friday's resume cron
 *  drains the remainder against a fresh daily quota. */
export const NEWSLETTER_DAILY_SEND_BUDGET = 85;

/** Click-rank window. `newsletter_clicks` stores campaign + event, not a
 *  recipient, so the send route can only flag clickers when the caller can
 *  prove an email (see `withRecentClicks`). Guessing via send_log ("was on a
 *  campaign that someone clicked") would treat last week's whole list as
 *  clickers and push this week's newest confirms into Friday. Blank beats that. */
export const NEWSLETTER_CLICK_RANK_DAYS = 30;

export type NewsletterSubscriber = {
  email: string;
  unsubscribe_token: string;
};

/** Rank fields for Thursday wave-1 ordering. `sendCampaign` still only needs
 *  email + token; ranking runs before the ledger select. */
export type RankableSubscriber = NewsletterSubscriber & {
  visitor_class?: string | null;
  confirmed_at?: string | null;
  created_at?: string | null;
  recentClick?: boolean;
};

export type SendLogStatus = "pending" | "sent" | "failed" | "suppressed";

export type SendLogInput = {
  campaignId: string;
  email: string;
  status: SendLogStatus;
  resendId?: string | null;
  error?: string | null;
};

export type SendLogState = {
  email: string;
  status: SendLogStatus;
};

type BatchSuccess = {
  id: string;
};

type BatchValidationError = {
  index: number;
  message: string;
};

export type ResendBatchResult = {
  data?: {
    data: BatchSuccess[];
    errors?: BatchValidationError[];
  } | null;
  error?: unknown;
};

export type CampaignSendSummary = {
  /** Recipients delivered by THIS run (batch + retry passes). */
  sentNow: number;
  /** Total `sent` ledger rows for the campaign after this run — the honest
   *  delivered count across all runs/resumes. */
  deliveredTotal: number;
  /** Skipped because the ledger already records them as sent (idempotent resume). */
  alreadySent: number;
  /** Skipped because newsletter_suppressions lists them. */
  suppressed: number;
  /** Skipped because a prior run left them `pending` (crashed mid-flight —
   *  delivery unknown, needs a human look). */
  blockedPending: string[];
  /** This run's terminal failures (after the retry pass). */
  failures: { email: string; error: string }[];
  /** Eligible recipients not attempted this run because of the daily budget.
   *  Friday's resume (or a re-hit of this route) sends them next. */
  remainder: number;
};

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function resendErrorMessage(error: unknown): string {
  if (!error) return "unknown Resend error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return JSON.stringify(error).slice(0, 500);
}

/** Stable fingerprint of a batch's recipient list — combined with the campaign
 *  id it makes a Resend idempotency key, so even a duplicate HTTP call for the
 *  same chunk cannot double-send. */
export function batchRecipientHash(subscribers: NewsletterSubscriber[]): string {
  return createHash("sha256")
    .update(subscribers.map((sub) => sub.email).join("\n"))
    .digest("hex")
    .slice(0, 32);
}

/** Bucket the active list against the ledger + suppression list. Only `toSend`
 *  gets an email: fresh addresses and previously-`failed` ones (safe to retry). */
export function selectSubscribersForSend(
  subscribers: NewsletterSubscriber[],
  priorState: Map<string, SendLogState>,
  suppressed: Set<string>
) {
  const alreadySent: NewsletterSubscriber[] = [];
  const blockedPending: NewsletterSubscriber[] = [];
  const suppressedSubscribers: NewsletterSubscriber[] = [];
  const toSend: NewsletterSubscriber[] = [];

  for (const sub of subscribers) {
    const state = priorState.get(sub.email);
    if (suppressed.has(sub.email)) {
      suppressedSubscribers.push(sub);
    } else if (state?.status === "sent") {
      alreadySent.push(sub);
    } else if (state?.status === "pending") {
      blockedPending.push(sub);
    } else {
      toSend.push(sub);
    }
  }

  return { toSend, alreadySent, blockedPending, suppressedSubscribers };
}

function isLocalOrHub(visitorClass: string | null | undefined): boolean {
  const cls = (visitorClass ?? "").toLowerCase();
  return cls === "local" || cls === "hub";
}

function confirmedStamp(sub: RankableSubscriber): string {
  return sub.confirmed_at || sub.created_at || "";
}

function rankTier(sub: RankableSubscriber): number {
  if (isLocalOrHub(sub.visitor_class)) return 0;
  if (sub.recentClick) return 1;
  return 2;
}

/** Stamp `recentClick` from a proven email set. Does not invent clickers. */
export function withRecentClicks<T extends { email: string }>(
  subs: T[],
  clickEmails: Iterable<string>
): (T & { recentClick: boolean })[] {
  const clicks = new Set(
    [...clickEmails].map((e) => e.toLowerCase()).filter(Boolean)
  );
  return subs.map((s) => ({
    ...s,
    recentClick: clicks.has(s.email.toLowerCase()),
  }));
}

/** Thursday wave-1 order: local/hub, then proven recent clickers, then newest
 *  confirmed (`confirmed_at` falling back to `created_at`), then everyone else.
 *  Stable on email. Does not mutate the input. */
export function rankSubscribersForSend<T extends RankableSubscriber>(subs: T[]): T[] {
  return [...subs].sort((a, b) => {
    const tier = rankTier(a) - rankTier(b);
    if (tier !== 0) return tier;
    const tb = confirmedStamp(b);
    const ta = confirmedStamp(a);
    if (ta !== tb) return tb.localeCompare(ta);
    return a.email.localeCompare(b.email);
  });
}

/** Hard-stop a run after `budget` eligible recipients so the rest wait for
 *  the next day's resume. Applied AFTER `selectSubscribersForSend`, so already
 *  `sent` rows never consume the cap. */
export function applyDailySendBudget<T>(
  toSend: readonly T[],
  budget: number = NEWSLETTER_DAILY_SEND_BUDGET
): { thisWave: T[]; remainder: T[] } {
  const cap = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  return {
    thisWave: toSend.slice(0, cap) as T[],
    remainder: toSend.slice(cap) as T[],
  };
}

/** Close the draft only when nobody eligible remains for a later resume.
 *  Cap remainder and terminal failures both keep it `pending`. Stuck
 *  `pending`-block rows are not eligible (a human recovers them via POST)
 *  and do not hold the draft open. */
export function shouldMarkDraftSent(summary: {
  remainder: number;
  failures: unknown[];
}): boolean {
  return summary.remainder === 0 && summary.failures.length === 0;
}

export type CampaignDraftPick<T extends { status: string; target_send_date: string }> =
  | { action: "send"; draft: T; resume: boolean }
  | { action: "skip"; reason: string; slack: boolean };

/** Thursday: today's pending draft. Friday (or a late retry): any older still-
 *  pending campaign. A vetoed/sent row for today skips the whole run (leftovers
 *  wait until Friday). Friday with nothing to drain is a quiet skip (no Slack);
 *  Thursday with no draft still warns. */
export function pickCampaignDraft<T extends { status: string; target_send_date: string }>(opts: {
  today: string;
  utcWeekday: number;
  todayDraft: T | null;
  incompleteDrafts: T[];
}): CampaignDraftPick<T> {
  const { today, utcWeekday, todayDraft, incompleteDrafts } = opts;
  if (todayDraft?.status === "pending") {
    return { action: "send", draft: todayDraft, resume: false };
  }
  // A vetoed/sent/canceled row for TODAY is a decision about this fire of the
  // cron. Do not also start a different campaign on the same run; Friday (no
  // today-draft) is what drains leftovers.
  if (todayDraft && todayDraft.status !== "pending") {
    const reason =
      todayDraft.status === "vetoed"
        ? `Draft for ${today} was vetoed — held by a human.`
        : `Draft for ${today} is "${todayDraft.status}", not sendable.`;
    return { action: "skip", reason, slack: true };
  }
  const incomplete = incompleteDrafts.find((d) => d.status === "pending");
  if (incomplete) {
    return { action: "send", draft: incomplete, resume: true };
  }
  const friday = utcWeekday === 5;
  return {
    action: "skip",
    reason: friday
      ? "No incomplete campaign to resume."
      : `No newsletter draft exists for ${today} (prepare didn't run).`,
    slack: !friday,
  };
}

/** Map one Resend batch response back to per-recipient ledger rows. Resend
 *  returns successes as a dense array and validation errors by index, so the
 *  success cursor must skip failed indexes — mapping by position alone would
 *  attribute message ids to the wrong recipients (the exact bug the ledger
 *  exists to prevent). */
export function mapBatchSendResult({
  campaignId,
  subscribers,
  result,
}: {
  campaignId: string;
  subscribers: NewsletterSubscriber[];
  result: ResendBatchResult;
}) {
  const rows: SendLogInput[] = [];
  const errors: string[] = [];
  let sent = 0;

  if (result.error || !result.data) {
    const message = resendErrorMessage(result.error);
    for (const sub of subscribers) {
      errors.push(`${sub.email}: ${message}`);
      rows.push({
        campaignId,
        email: sub.email,
        status: "failed",
        error: message,
      });
    }
    return { sent, rows, errors };
  }

  const validationErrors = new Map<number, string>();
  for (const err of result.data.errors ?? []) {
    validationErrors.set(err.index, err.message);
  }

  let successCursor = 0;
  for (const [recipientIndex, sub] of subscribers.entries()) {
    const validationError = validationErrors.get(recipientIndex);
    if (validationError) {
      errors.push(`${sub.email}: ${validationError}`);
      rows.push({
        campaignId,
        email: sub.email,
        status: "failed",
        error: validationError,
      });
      continue;
    }

    const resendId = result.data.data[successCursor++]?.id;
    if (!resendId) {
      const message = "Resend batch response did not include a message id";
      errors.push(`${sub.email}: ${message}`);
      rows.push({
        campaignId,
        email: sub.email,
        status: "failed",
        error: message,
      });
      continue;
    }

    sent++;
    rows.push({
      campaignId,
      email: sub.email,
      status: "sent",
      resendId,
    });
  }

  return { sent, rows, errors };
}

// ---------------------------------------------------------------------------
// IO: ledger reads/writes + the orchestrator. Everything below talks to
// Supabase/Resend; everything above is pure and unit-tested.
// ---------------------------------------------------------------------------

async function getSendLogState(
  supabase: SupabaseClient,
  campaignId: string,
  emails: string[]
): Promise<Map<string, SendLogState>> {
  const state = new Map<string, SendLogState>();
  for (const group of chunk([...new Set(emails)], 500)) {
    const { data, error } = await supabase
      .from("newsletter_send_log")
      .select("email, status")
      .eq("campaign_id", campaignId)
      .in("email", group);
    if (error) throw error;
    for (const row of data ?? []) {
      state.set(row.email, row as SendLogState);
    }
  }
  return state;
}

async function getSuppressedEmails(
  supabase: SupabaseClient,
  emails: string[]
): Promise<Set<string>> {
  const suppressed = new Set<string>();
  for (const group of chunk([...new Set(emails)], 500)) {
    const { data, error } = await supabase
      .from("newsletter_suppressions")
      .select("email")
      .in("email", group);
    if (error) throw error;
    for (const row of data ?? []) suppressed.add(row.email);
  }
  return suppressed;
}

async function recordSendLog(supabase: SupabaseClient, rows: SendLogInput[]) {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  for (const group of chunk(rows, 500)) {
    const { error } = await supabase.from("newsletter_send_log").upsert(
      group.map((row) => ({
        campaign_id: row.campaignId,
        email: row.email,
        status: row.status,
        resend_id: row.resendId ?? null,
        error: row.error ?? null,
        attempted_at: now,
        sent_at: row.status === "sent" ? now : null,
        updated_at: now,
      })),
      { onConflict: "campaign_id,email" }
    );
    if (error) throw error;
  }
}

async function countLedgerSent(
  supabase: SupabaseClient,
  campaignId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("newsletter_send_log")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sent");
  if (error) throw error;
  return count ?? 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The one idempotent send. Both the Thursday cron (GET) and the targeted
 * recovery (POST) are thin wrappers over this: load ledger state, exclude
 * anyone already sent / suppressed / stuck pending, slice the remainder to
 * the daily budget (HWY-44), pre-mark each batch `pending`, ship via the
 * Batch API (permissive validation + an idempotency key per chunk), upsert
 * every per-recipient result back, then run one throttled per-message retry
 * pass over this run's failures. Recipients past the budget are not marked
 * pending and wait for the next run.
 */
export async function sendCampaign({
  supabase,
  resend,
  campaignId,
  subscribers,
  buildMessage,
  throttleMs = 500,
  dailyBudget = NEWSLETTER_DAILY_SEND_BUDGET,
}: {
  supabase: SupabaseClient;
  resend: Resend;
  campaignId: string;
  subscribers: NewsletterSubscriber[];
  buildMessage: (sub: NewsletterSubscriber) => CreateBatchEmailOptions;
  throttleMs?: number;
  dailyBudget?: number;
}): Promise<CampaignSendSummary> {
  const emails = subscribers.map((s) => s.email);
  const priorState = await getSendLogState(supabase, campaignId, emails);
  const suppressed = await getSuppressedEmails(supabase, emails);
  const { toSend, alreadySent, blockedPending, suppressedSubscribers } =
    selectSubscribersForSend(subscribers, priorState, suppressed);

  const { thisWave, remainder } = applyDailySendBudget(toSend, dailyBudget);

  let sentNow = 0;
  const failures: { email: string; error: string }[] = [];

  const groups = chunk(thisWave, NEWSLETTER_BATCH_SIZE);
  for (const [batchIndex, group] of groups.entries()) {
    // Pending BEFORE the attempt: if we crash mid-flight, the next run blocks
    // these addresses instead of double-sending into the unknown.
    await recordSendLog(
      supabase,
      group.map((sub) => ({ campaignId, email: sub.email, status: "pending" as const }))
    );

    let result: ResendBatchResult;
    try {
      result = (await resend.batch.send(
        group.map(buildMessage),
        {
          // One bad address must not reject the other 99 in its chunk.
          batchValidation: "permissive",
          // Same campaign + same recipients = same key: a duplicate HTTP call
          // (retry, double cron fire) cannot double-send the chunk.
          idempotencyKey: `newsletter:${campaignId}:${batchRecipientHash(group)}`,
        }
      )) as ResendBatchResult;
    } catch (err) {
      result = { error: err };
    }

    const mapped = mapBatchSendResult({ campaignId, subscribers: group, result });
    sentNow += mapped.sent;
    for (const row of mapped.rows) {
      if (row.status === "failed") {
        failures.push({ email: row.email, error: row.error ?? "unknown" });
      }
    }
    await recordSendLog(supabase, mapped.rows);

    if (batchIndex < groups.length - 1) await sleep(throttleMs);
  }

  // Retry pass — most batch-level failures are transient (429s). One throttled
  // single-recipient batch each; results land in the ledger like any other.
  if (failures.length > 0) {
    const toRetry = failures.splice(0, failures.length);
    for (const f of toRetry) {
      const sub = thisWave.find((s) => s.email === f.email);
      if (!sub) continue;
      await sleep(1200);
      let result: ResendBatchResult;
      try {
        result = (await resend.batch.send([buildMessage(sub)], {
          batchValidation: "permissive",
          idempotencyKey: `newsletter:${campaignId}:retry:${batchRecipientHash([sub])}`,
        })) as ResendBatchResult;
      } catch (err) {
        result = { error: err };
      }
      const mapped = mapBatchSendResult({ campaignId, subscribers: [sub], result });
      sentNow += mapped.sent;
      for (const row of mapped.rows) {
        if (row.status === "failed") {
          failures.push({ email: row.email, error: row.error ?? "unknown" });
        }
      }
      await recordSendLog(supabase, mapped.rows);
    }
  }

  const deliveredTotal = await countLedgerSent(supabase, campaignId);

  return {
    sentNow,
    deliveredTotal,
    alreadySent: alreadySent.length,
    suppressed: suppressedSubscribers.length,
    blockedPending: blockedPending.map((s) => s.email),
    failures,
    remainder: remainder.length,
  };
}
