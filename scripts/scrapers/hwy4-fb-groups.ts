import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { getApifyToken, runApifyActorSync } from "../lib/apify-client.js";
import {
  buildGroupPostPrompt,
  buildSubmissionRows,
  cursorKey,
  groupMessageId,
  looksLikeEventPost,
  mapGroupPost,
  nextCursor,
  postsAfterCursor,
  type GroupConfig,
  type GroupPost,
} from "../lib/facebook-groups.js";
import {
  parseExtractedEvents,
  normalizeExtracted,
  type NormalizedEvent,
} from "../../lib/inbound-email.js";

/**
 * Hwy 4 Facebook GROUP scraper — a front door onto the submissions queue.
 *
 * Unlike every other scraper in this directory, this one writes NOTHING to
 * hwy4_events. It lands pending `event_submissions` rows and stops. The
 * reasoning is in scripts/lib/facebook-groups.ts: a group post asserts no date,
 * no venue and no stable per-event id, so a row derived from one is
 * unverifiable, uncorrectable and unretractable — the Murphys Irish Pub phantom
 * shape. A human clicking Publish at /admin/submissions is the pin.
 *
 * Triage is NOT called from here. The daily /api/agent/triage-submissions cron
 * (18:30 UTC) already picks up every pending row with ai_analyzed_at IS NULL,
 * and this Action runs ~11:30 UTC, so an opinion is waiting the same afternoon.
 * That keeps ANTHROPIC/agent wiring out of the scrape job and gives the retry
 * for free.
 *
 * Cost control is two-layered: a strict candidate filter (looksLikeEventPost)
 * decides which posts are worth a model call at all, and a per-group
 * high-water cursor in site_config stops us re-reading the same post daily.
 *
 * Run alone:  cd scripts && npm run scrape -- --source hwy4-fb-groups
 * Dry run:    cd scripts && npm run scrape -- --source hwy4-fb-groups --dry-run
 *   (--dry-run extracts and prints, writes no submissions and no cursor, and
 *    dumps the first raw Apify item so the actor's field shape can be verified.)
 */

// The official Apify group actor. Its input schema is not guaranteed stable
// across store versions, which is why mapGroupPost reads permissively and why
// --dry-run prints a raw item.
const APIFY_ACTOR = "apify~facebook-groups-scraper";

const MODEL = "claude-sonnet-4-6";

/** Posts pulled per group per run, before filtering. */
const RESULTS_LIMIT = 60;

/** Hard ceiling on model calls per group per run, so a group that suddenly
 *  floods (or a filter regression) cannot run up a bill unattended. */
const MAX_EXTRACTIONS_PER_GROUP = 12;

/** First run with no cursor: how far back to consider. */
const FIRST_RUN_DAYS = 14;

/**
 * The corridor groups we read. PUBLIC groups only — a private group needs a
 * member's Facebook session cookies pasted into the actor, which would mean
 * Rob's personal FB session living in a CI secret with an account-ban attached.
 * Not worth it for long-tail listings.
 *
 * To add a group: confirm it is public (open it in a logged-OUT browser and
 * check posts are visible), then add an entry here and insert the org row is
 * NOT needed — these land as submissions, not events, so no hwy4_orgs FK.
 */
export const GROUP_CONFIGS: GroupConfig[] = [
  {
    slug: "uh4ccc",
    url: "https://www.facebook.com/groups/uh4ccc",
    label: "Upper Hwy 4 Community",
  },
  // Candidates to add once confirmed public:
  // { slug: "arnold-ca",  url: "https://www.facebook.com/groups/<slug>", label: "Arnold Community" },
  // { slug: "murphys-ca", url: "https://www.facebook.com/groups/<slug>", label: "Murphys Community" },
];

interface GroupRunStats {
  fetched: number;
  candidates: number;
  extracted: number;
  queued: number;
  skippedExisting: number;
  error?: string;
}

async function readCursor(group: GroupConfig): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("site_config")
    .select("value")
    .eq("key", cursorKey(group))
    .maybeSingle();
  return data?.value ?? null;
}

async function writeCursor(group: GroupConfig, value: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("site_config")
    .upsert(
      { key: cursorKey(group), value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) console.error(`  Cursor upsert failed: ${error.message}`);
}

async function fetchGroupPosts(group: GroupConfig): Promise<unknown[]> {
  return runApifyActorSync<unknown>({
    actor: APIFY_ACTOR,
    input: {
      startUrls: [{ url: group.url }],
      resultsLimit: RESULTS_LIMIT,
    },
    timeoutMs: 180000,
  });
}

/** Ask the model to read ONE post. Returns [] on any failure — a group post is
 *  never important enough to fail a scrape run over. */
async function extractFromPost(
  client: Anthropic,
  group: GroupConfig,
  post: GroupPost,
  today: string
): Promise<NormalizedEvent[]> {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: buildGroupPostPrompt({ today, groupLabel: group.label, post }),
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseExtractedEvents(text)
      .map(normalizeExtracted)
      .filter((e): e is NormalizedEvent => e !== null);
  } catch (err) {
    console.warn(
      `  Extraction failed for post ${post.id}: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

/** Drop events already dated in the past — a group post is often a recap, and
 *  the model faithfully extracts "the parade was great on the 4th". */
function futureOnly(events: NormalizedEvent[], today: string): NormalizedEvent[] {
  return events.filter((e) => e.date >= today);
}

async function scrapeGroup(
  client: Anthropic,
  group: GroupConfig,
  today: string,
  dryRun: boolean
): Promise<GroupRunStats> {
  const stats: GroupRunStats = {
    fetched: 0,
    candidates: 0,
    extracted: 0,
    queued: 0,
    skippedExisting: 0,
  };

  console.log(`\n--- ${group.label} (${group.url}) ---`);

  let raw: unknown[];
  try {
    raw = await fetchGroupPosts(group);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Apify fetch failed: ${msg}`);
    stats.error = msg;
    return stats;
  }

  stats.fetched = raw.length;
  console.log(`  Apify returned ${raw.length} item(s)`);
  if (dryRun && raw.length > 0) {
    console.log(`  Raw item shape:\n${JSON.stringify(raw[0], null, 2).slice(0, 1200)}`);
  }

  const posts = raw
    .map(mapGroupPost)
    .filter((p): p is GroupPost => p !== null);
  if (posts.length < raw.length) {
    console.log(`  ${raw.length - posts.length} item(s) unmappable (no text or no id) — skipped`);
  }

  // Window: everything newer than the cursor, or the last FIRST_RUN_DAYS on a
  // first run. A fetch that returns nothing leaves the cursor untouched.
  const stored = await readCursor(group);
  const floor =
    stored ??
    new Date(Date.now() - FIRST_RUN_DAYS * 86400000).toISOString();
  const fresh = postsAfterCursor(posts, floor);
  console.log(
    `  ${fresh.length} post(s) newer than ${stored ? "cursor" : `${FIRST_RUN_DAYS}-day floor`} ${floor.slice(0, 10)}`
  );

  const candidates = fresh.filter((p) => looksLikeEventPost(p.text));
  stats.candidates = candidates.length;
  console.log(`  ${candidates.length} look like event announcements`);

  const budgeted = candidates.slice(0, MAX_EXTRACTIONS_PER_GROUP);
  if (budgeted.length < candidates.length) {
    console.log(
      `  Capping at ${MAX_EXTRACTIONS_PER_GROUP} extraction(s) this run (${candidates.length - budgeted.length} deferred to tomorrow)`
    );
  }

  for (const post of budgeted) {
    // The unique index would refuse a duplicate anyway; checking first avoids
    // paying for a model call on a post we have already read.
    //
    // Known edge: this only catches posts that PRODUCED an event. A post we read
    // and correctly found nothing in is covered by the cursor instead — unless
    // it carries no timestamp, in which case it is re-read until it falls out of
    // the newest RESULTS_LIMIT posts. Bounded by feed turnover and by
    // MAX_EXTRACTIONS_PER_GROUP, so it is a small bounded cost rather than a
    // leak; not worth a "posts we have seen" ledger table.
    const { data: seen } = await supabaseAdmin
      .from("event_submissions")
      .select("id")
      .eq("source_message_id", groupMessageId(post, 0))
      .limit(1);
    if (seen && seen.length > 0) {
      stats.skippedExisting++;
      continue;
    }

    const events = futureOnly(await extractFromPost(client, group, post, today), today);
    if (events.length === 0) continue;
    stats.extracted += events.length;

    const rows = buildSubmissionRows({ post, group, events });
    console.log(
      `  ${post.url ?? post.id}\n    → ${events.map((e) => `${e.name} | ${e.date}`).join("\n    → ")}`
    );

    if (dryRun) continue;

    const { error } = await supabaseAdmin.from("event_submissions").insert(rows);
    if (error) {
      // 23505 = the unique source_message_id index fired: already ingested.
      if (error.code === "23505") {
        stats.skippedExisting++;
        continue;
      }
      console.error(`  Submission insert failed: ${error.message}`);
      continue;
    }
    stats.queued += rows.length;
  }

  // Advance the cursor over everything READ this run, including posts that
  // yielded nothing, so they are not re-billed tomorrow.
  const advanced = nextCursor(stored, fresh);
  if (!dryRun && advanced && advanced !== stored) {
    await writeCursor(group, advanced);
    console.log(`  Cursor → ${advanced}`);
  }

  return stats;
}

export async function scrapeHwy4FbGroups(): Promise<void> {
  console.log("=== Hwy 4 Facebook Groups (→ submissions queue) ===");

  if (GROUP_CONFIGS.length === 0) {
    console.log("No groups configured — skipping");
    return;
  }
  if (!getApifyToken()) {
    console.log("Skipping FB Groups (no APIFY_API_TOKEN set)");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Skipping FB Groups (no ANTHROPIC_API_KEY set)");
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("DRY RUN — no submissions or cursors will be written");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const today = new Date().toISOString().slice(0, 10);

  const totals: GroupRunStats = {
    fetched: 0,
    candidates: 0,
    extracted: 0,
    queued: 0,
    skippedExisting: 0,
  };
  const failed: string[] = [];

  for (const group of GROUP_CONFIGS) {
    const stats = await scrapeGroup(client, group, today, dryRun);
    totals.fetched += stats.fetched;
    totals.candidates += stats.candidates;
    totals.extracted += stats.extracted;
    totals.queued += stats.queued;
    totals.skippedExisting += stats.skippedExisting;
    if (stats.error) failed.push(`${group.label}: ${stats.error}`);
  }

  console.log(`\n=== Facebook Groups Summary ===`);
  console.log(`Posts fetched:        ${totals.fetched}`);
  console.log(`Event-like posts:     ${totals.candidates}`);
  console.log(`Events extracted:     ${totals.extracted}`);
  console.log(`Submissions queued:   ${totals.queued}`);
  console.log(`Already ingested:     ${totals.skippedExisting}`);
  if (totals.queued > 0) {
    console.log(`Review at /admin/submissions (triage cron runs 18:30 UTC)`);
  }
  // A fetch failure must show up in the SUMMARY, not only in a warn line
  // scrolled past in the Action log — a source that quietly returns nothing
  // reads identically to a quiet week otherwise (HWY-18).
  if (failed.length > 0) {
    console.log(`Groups that FAILED to fetch: ${failed.length}`);
    for (const f of failed) console.log(`  - ${f}`);
  }
}
