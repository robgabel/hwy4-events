// Locks the pure core of Facebook GROUP ingestion (scripts/lib/facebook-groups.ts):
// the permissive post mapper, the strict candidate filter, the submission-row
// builder, and the high-water cursor. No network, no DB, no model call.
//
// The filter tests carry the most weight. A community group is mostly chatter,
// and every false positive costs a model call AND a slot in Rob's review queue;
// a queue that fills with noise stops getting opened, which is how a source
// dies. So these assert what must be REJECTED as hard as what must pass.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_POST_CHARS,
  buildGroupPostPrompt,
  buildSubmissionRows,
  cursorKey,
  groupMessageId,
  looksLikeEventPost,
  mapGroupPost,
  nextCursor,
  normalizePostedAt,
  postsAfterCursor,
  GROUP_SOURCE,
  type GroupConfig,
  type GroupPost,
} from "../lib/facebook-groups.js";
import type { NormalizedEvent } from "../../lib/inbound-email.js";

const GROUP: GroupConfig = {
  slug: "uh4ccc",
  url: "https://www.facebook.com/groups/uh4ccc",
  label: "Upper Hwy 4 Community",
};

const POST: GroupPost = {
  id: "https://www.facebook.com/groups/uh4ccc/permalink/27337390619253933/",
  url: "https://www.facebook.com/groups/uh4ccc/permalink/27337390619253933/",
  text: "Join us Saturday July 4 at 10am for the parade!",
  postedAt: "2026-06-28T15:00:00.000Z",
};

// ─── mapGroupPost ───────────────────────────────────────────────────────────

test("mapGroupPost: reads competing Apify field names", () => {
  const a = mapGroupPost({ text: "hello there", url: "https://fb.com/p/1", time: 1751000000 });
  assert.equal(a?.text, "hello there");
  assert.equal(a?.url, "https://fb.com/p/1");
  assert.equal(a?.id, "https://fb.com/p/1");

  // Alternate spellings across store actors.
  const b = mapGroupPost({ postText: "second", postUrl: "https://fb.com/p/2" });
  assert.equal(b?.text, "second");
  assert.equal(b?.id, "https://fb.com/p/2");

  const c = mapGroupPost({ message: "third", postId: "12345" });
  assert.equal(c?.text, "third");
  assert.equal(c?.id, "12345");
  assert.equal(c?.url, null, "no permalink field means no url, not a guessed one");
});

test("mapGroupPost: rejects items with no text or no identity", () => {
  // No text: nothing to extract from.
  assert.equal(mapGroupPost({ url: "https://fb.com/p/1" }), null);
  assert.equal(mapGroupPost({ text: "   ", url: "https://fb.com/p/1" }), null);
  // No id and no url: we could re-ingest it every single run.
  assert.equal(mapGroupPost({ text: "an orphan post" }), null);
  // Not an object at all.
  assert.equal(mapGroupPost(null), null);
  assert.equal(mapGroupPost("a string"), null);
});

test("normalizePostedAt: seconds, millis, ISO, and never a fabricated now", () => {
  assert.equal(normalizePostedAt(1782538400), "2026-06-27T05:33:20.000Z");
  assert.equal(normalizePostedAt(1782538400000), "2026-06-27T05:33:20.000Z");
  assert.equal(normalizePostedAt("1782538400"), "2026-06-27T05:33:20.000Z");
  assert.equal(normalizePostedAt("2026-06-27T05:33:20.000Z"), "2026-06-27T05:33:20.000Z");
  // An unusable value must yield null. Defaulting to "now" would silently
  // advance the cursor past posts we never read.
  assert.equal(normalizePostedAt(undefined), null);
  assert.equal(normalizePostedAt(""), null);
  assert.equal(normalizePostedAt("not a date"), null);
  assert.equal(normalizePostedAt({}), null);
});

// ─── looksLikeEventPost ─────────────────────────────────────────────────────

test("looksLikeEventPost: passes real corridor announcements", () => {
  const yes = [
    "Join us Saturday July 4 at 10am for the annual parade down Main Street. Bring chairs!",
    "Live music at the saloon this Friday, 7pm. No cover, come on out and support the band.",
    "Pancake breakfast fundraiser Sunday 8/17 from 8-11am at the fire hall. $10 adults.",
    "Save the date: the craft fair is back on October 12. Vendor sign-ups open now.",
    "Trail work day next Saturday, meet at the trailhead at 9am. Bring gloves and water.",
    "Trivia night is back! Every Wednesday at 6:30 pm starting Sept 3.",
  ];
  for (const t of yes) {
    assert.equal(looksLikeEventPost(t), true, `should PASS: ${t}`);
  }
});

test("looksLikeEventPost: rejects the chatter that fills a community group", () => {
  const no = [
    // Questions — the most common false positive in a group.
    "Does anyone know if the parade is still happening Saturday? Heard it might be cancelled.",
    "Anyone have a recommendation for live music around here on a Friday night?",
    // Classifieds.
    "For sale: barely used snowblower, $300 obo. Available this weekend, message me.",
    "Lost dog near the store since Tuesday afternoon, please call if you see him.",
    // Chat with a date but no event.
    "Beautiful sunset tonight at 8pm over the ridge, had to share.",
    // Event words but no day anchor at all.
    "The band that played last summer was incredible, best concert I have been to.",
    // Too short to carry any real detail.
    "Parade Saturday!",
  ];
  for (const t of no) {
    assert.equal(looksLikeEventPost(t), false, `should REJECT: ${t}`);
  }
});

test("looksLikeEventPost: needs BOTH a day anchor and an event signal", () => {
  // Event signal, no date signal.
  assert.equal(looksLikeEventPost("We are having a fundraiser at the community hall soon, details to follow later."), false);
  // Date signal, no event signal.
  assert.equal(looksLikeEventPost("Road is finally clear as of Saturday morning, drive safe out there everyone."), false);
  // Both present.
  assert.equal(looksLikeEventPost("Fundraiser at the community hall Saturday, doors open at 5pm sharp."), true);
});

test("looksLikeEventPost: an announcement phrase overrides the question opener", () => {
  // Opens like a question but is plainly an announcement.
  assert.equal(
    looksLikeEventPost("Anyone free Saturday? Join us for the potluck at 5pm, bring a dish to share."),
    true
  );
});

test("looksLikeEventPost: enforces the length floor", () => {
  const short = "Show Friday 7pm";
  assert.ok(short.length < MIN_POST_CHARS);
  assert.equal(looksLikeEventPost(short), false);
  assert.equal(looksLikeEventPost(""), false);
});

// ─── Prompt ─────────────────────────────────────────────────────────────────

test("buildGroupPostPrompt: group framing + the shared corridor contract", () => {
  const p = buildGroupPostPrompt({ today: "2026-09-05", groupLabel: GROUP.label, post: POST });
  // The shared contract came through.
  assert.match(p, /Today is 2026-09-05/);
  assert.match(p, /Murphys/);
  assert.match(p, /JSON array/);
  assert.match(p, /Do NOT invent a date/);
  // Group-specific framing, including the escape hatch renamed off "email".
  assert.match(p, /community Facebook group/);
  assert.match(p, /Upper Hwy 4 Community/);
  assert.match(p, /If the post contains no determinable corridor event, return exactly \[\]/);
  assert.doesNotMatch(p, /Email body/);
  // The post's own text and its posted date reach the model.
  assert.match(p, /Join us Saturday July 4/);
  assert.match(p, /post made 2026-06-28/);
});

// ─── Submission rows ────────────────────────────────────────────────────────

const EVENT: NormalizedEvent = {
  name: "Independence Day Parade",
  date: "2026-07-04",
  start_time: "10:00",
  end_time: null,
  venue_name: "Main Street",
  town: "Arnold",
  description: "The annual parade.",
  category: "festival",
  artists: null,
  price: null,
  confidence: "high",
};

test("buildSubmissionRows: pins every row to the post permalink", () => {
  const rows = buildSubmissionRows({ post: POST, group: GROUP, events: [EVENT] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.event_name, "Independence Day Parade");
  assert.equal(r.event_date, "2026-07-04");
  assert.equal(r.source, GROUP_SOURCE);
  // THE point of the design: the row carries a link back to the sentence a
  // human actually wrote, so a reviewer can read the original before publishing.
  assert.equal(r.event_url, POST.url);
  assert.equal(r.source_message_id, `fbgroup:${POST.id}#0`);
  assert.equal(r.submitter_name, GROUP.label);
  assert.equal(r.submitter_email, null);
  // The full post text is retained for the "original post" view.
  assert.equal((r.raw_email as { text: string }).text, POST.text);
  assert.equal((r.raw_email as { confidence: string }).confidence, "high");
});

test("buildSubmissionRows: multiple events from one post get distinct keys", () => {
  const second: NormalizedEvent = { ...EVENT, name: "Fireworks", date: "2026-07-04" };
  const rows = buildSubmissionRows({ post: POST, group: GROUP, events: [EVENT, second] });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].source_message_id, rows[1].source_message_id);
  assert.equal(rows[1].source_message_id, `fbgroup:${POST.id}#1`);
});

test("buildSubmissionRows: a null town becomes empty string, never invented", () => {
  const rows = buildSubmissionRows({
    post: POST,
    group: GROUP,
    events: [{ ...EVENT, town: null, venue_name: null }],
  });
  assert.equal(rows[0].town, "");
  assert.equal(rows[0].venue_name, null);
});

test("groupMessageId / cursorKey are stable", () => {
  assert.equal(groupMessageId(POST, 0), `fbgroup:${POST.id}#0`);
  assert.equal(cursorKey(GROUP), "fb_group_cursor_uh4ccc");
});

// ─── Cursor ─────────────────────────────────────────────────────────────────

const p = (id: string, postedAt: string | null): GroupPost => ({
  id,
  url: null,
  text: "x",
  postedAt,
});

test("nextCursor: advances to the newest post READ, not the newest that hit", () => {
  const read = [p("a", "2026-09-01T00:00:00.000Z"), p("b", "2026-09-03T00:00:00.000Z")];
  assert.equal(nextCursor(null, read), "2026-09-03T00:00:00.000Z");
  assert.equal(nextCursor("2026-08-01T00:00:00.000Z", read), "2026-09-03T00:00:00.000Z");
});

test("nextCursor: never moves backwards, and never moves on an empty read", () => {
  const existing = "2026-09-10T00:00:00.000Z";
  // An older batch must not rewind the window.
  assert.equal(nextCursor(existing, [p("a", "2026-09-01T00:00:00.000Z")]), existing);
  // A broken fetch (nothing read) leaves the cursor exactly where it was, so
  // the window can never skip forward past posts we never saw.
  assert.equal(nextCursor(existing, []), existing);
  assert.equal(nextCursor(existing, [p("a", null)]), existing);
  assert.equal(nextCursor(null, []), null);
});

test("postsAfterCursor: strictly newer, but keeps undated posts", () => {
  const posts = [
    p("old", "2026-09-01T00:00:00.000Z"),
    p("same", "2026-09-05T00:00:00.000Z"),
    p("new", "2026-09-09T00:00:00.000Z"),
    p("undated", null),
  ];
  const kept = postsAfterCursor(posts, "2026-09-05T00:00:00.000Z").map((x) => x.id);
  // "same" is excluded: we already read that one.
  assert.deepEqual(kept, ["new", "undated"]);
  // No cursor: everything is in play.
  assert.equal(postsAfterCursor(posts, null).length, 4);
});

// ─── FB Discover town gating (scrapers/hwy4-fb-discover.ts) ─────────────────
//
// The five un-launched towns ship as real config entries with an empty
// locationId so enabling one is a single paste. That is only safe because an
// unconfigured entry is SKIPPED: Facebook's explore URL with an empty ID
// resolves to the global events page, which would pour non-corridor events into
// the corridor filter and burn an Apify run on every scrape.

test("isConfiguredTown: only a numeric place ID activates a town", async () => {
  const { isConfiguredTown } = await import("../lib/fb-town-config.js");
  const base = { orgSlug: "x", label: "X", defaultTown: "Arnold", exploreSlug: "x-ca" };

  assert.equal(isConfiguredTown({ ...base, locationId: "105475469485316" }), true);
  // The shipped placeholder must never run.
  assert.equal(isConfiguredTown({ ...base, locationId: "" }), false);
  assert.equal(isConfiguredTown({ ...base, locationId: "   " }), false);
  // A half-pasted or annotated value is not a place ID either.
  assert.equal(isConfiguredTown({ ...base, locationId: "TODO" }), false);
  assert.equal(isConfiguredTown({ ...base, locationId: "1054754694853xx" }), false);
  assert.equal(isConfiguredTown({ ...base, locationId: "id=105475469485316" }), false);
  // Stray whitespace around a real paste is forgiven.
  assert.equal(isConfiguredTown({ ...base, locationId: " 105475469485316 " }), true);
});
