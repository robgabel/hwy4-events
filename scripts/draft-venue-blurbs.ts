/**
 * Draft local-voice venue blurbs for the event detail page using Claude Opus.
 *
 * Reads docs/LOCAL-KNOWLEDGE-BASE.md (the hyperlocal source of truth) and, for
 * each venue in hwy4_venues missing a blurb, writes a 2-3 sentence neighbor-voice
 * paragraph. Rob reviews before publish.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     tsx draft-venue-blurbs.ts                 # dry-run, venues missing a blurb
 *     tsx draft-venue-blurbs.ts --apply         # write the published blurb to hwy4_venues
 *     tsx draft-venue-blurbs.ts --queue --apply # stage a PENDING draft (blurb_draft) for human review
 *     tsx draft-venue-blurbs.ts --all           # include venues that already have a blurb
 *     tsx draft-venue-blurbs.ts --limit 5       # cap the batch
 *     tsx draft-venue-blurbs.ts murphys-irish-pub poor-house   # specific keys
 *
 * --queue is the self-healing path (PRD-live-music-experience.md Phase 1B): a
 * weekly GitHub Action runs `--queue --apply` and writes a Tier-B draft to
 * `blurb_draft` (never to the published `blurb`) for every venue missing one.
 * A human reviews + publishes (or discards) it at /admin/venues. It selects only
 * venues with no blurb AND no pending draft AND a resolved place_id, so it is
 * idempotent and self-limiting — once every venue is covered it does no work.
 *
 * Voice rules (no em dashes, no invented facts/hours, named-entity specifics)
 * are enforced in the system prompt and re-checked after generation, mirroring
 * scripts/draft-town-content.ts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { withVoice } from "../lib/voice.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ALL = args.includes("--all");
// Queue mode: stage a pending draft in blurb_draft for human review instead of
// publishing to blurb. The auto-drafting path (see header).
const QUEUE = args.includes("--queue");
const limitArg = args.find((a) => a.startsWith("--limit"));
const LIMIT = limitArg
  ? parseInt(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1] ?? "", 10) || Infinity
  : Infinity;
const outArg = args.find((a) => a.startsWith("--out"));
const OUT_FILE = outArg ? outArg.split("=")[1] ?? args[args.indexOf(outArg) + 1] ?? "" : "";
const explicitKeys = args.filter(
  (a) => !a.startsWith("--") && !/^\d+$/.test(a) && a !== OUT_FILE
);

const repoRoot = resolve(__dirname, "..");
const knowledgeBase = readFileSync(join(repoRoot, "docs/LOCAL-KNOWLEDGE-BASE.md"), "utf-8");
const aboutPage = readFileSync(join(repoRoot, "app/about/page.tsx"), "utf-8");

const SYSTEM_PROMPT = `You write venue blurbs in Rob Gabel's voice for Hwy 4 Events (hwy4events.com), a free community events guide for California's Highway 4 corridor in the Sierra Nevada foothills. Rob has lived in Arnold since 2015. He's talking to neighbors, not at tourists.

Your job: write ONE short blurb (2 to 3 sentences) about a single venue. It appears on an event's detail page under "About <venue>", so a visitor deciding whether to show up knows what kind of place this is. Rob reviews before it ships.

=== ROB'S VOICE (hard requirements) ===

NEVER USE EM DASHES (—). This is Rob's most-broken rule. Use commas, periods, semicolons, colons, or parentheses. Restructure into two sentences rather than reaching for a dash.

- SHORT. 2 to 3 sentences, full stop. This is a blurb, not an essay.
- Direct, specific, lightly wry. No corporate fog, no marketing speak.
- Reference REAL specifics from the knowledge base: owners, what the place is known for, the vibe, named menu items or features. "Giant Burger's been slinging burgers since 1968, and the breakfast burritos locals order aren't on the marquee" beats "a classic local eatery".
- First-person ("I" = Rob) only where it's natural; usually third person is fine.
- WORK IN PRACTICAL SIGNALS when the knowledge base supports them — these are what readers actually decide on: dog-friendly (or not), good for kids / strollers, big outdoor area for groups, walkable to other spots, indoor vs outdoor, parking, members-only. "Dogs are welcome on the fire roads but not the trails" or "a big outdoor area that takes large groups without reservations, dogs included" earns its place. Only state these when the source supports them; never invent a dog or kid policy.

=== DO NOT INVENT ===

Use ONLY facts present in the knowledge base for this venue. If the knowledge base is thin on this venue, write a shorter, honest blurb from what little is there. Made-up is worse than short.

NEVER assert specific hours or a weekly cadence ("open every day", "live music every Thursday", "7 nights a week") unless the knowledge base explicitly verifies it. These go stale and get quoted forever. Rob once caught a hallucinated "Murphys Irish Pub live music 7 nights a week" (the pub is closed Mon-Tue). If you must reference timing, hedge ("often", "most weeks") or omit it. The live facts strip handles current hours separately, so you don't need to state hours at all.

=== NEVER REFERENCE INTERNAL TOOLING (hard rule) ===

The blurb is public copy in Rob's voice. NEVER mention "the knowledge base", "my notes", "my sources", "public info", "the data", or any internal artifact — it breaks the voice and means nothing to a reader. When you don't have enough to say, punt like a neighbor would, in honest first person:
  GOOD: "My Bar sits on S Main in Angels Camp, but I've never been there. If you've been and have the scoop, send it our way!"
  GOOD: "I don't have much on it yet, so check their site before you go."
  BAD:  "the knowledge base doesn't have much specific on it yet."
  BAD:  "I don't have much in my notes."
  BAD:  "that's about all I can tell you from public info."
Only claim "I've never been" / "I haven't been in" if it's actually true for Rob; if unsure, use the neutral "I don't have much on it yet." Then point the reader somewhere useful: the event details, the venue's own site, or an invite to send the scoop.

=== BANNED PHRASES (never use these or close variants) ===
"discover", "explore", "your gateway to", "nestled in the heart of", "charming", "hidden gem", "something for everyone", "a slice of", "experience the magic", "step back in time", "moreover", "furthermore", "it's worth noting". Any line that could appear unchanged on another venue's page is a failure.

=== THE CONFERENCE-DINNER GUT CHECK ===
Would Rob say this out loud to another operator at a conference dinner? If it sounds like a marketing intern wrote it, rewrite or cut.

=== OUTPUT FORMAT ===
Return ONLY a JSON object, no markdown fences:
{
  "blurb": "the 2-3 sentence blurb",
  "has_source": true | false   // false if the knowledge base had little or nothing specific about this venue (blurb will be generic/short)
}`;

interface VenueRow {
  venue_key: string;
  canonical: string;
  town: string;
  address: string | null;
  blurb: string | null;
  blurb_draft: string | null;
  place_id: string | null;
  places_attributes: Record<string, unknown> | null;
}

/**
 * Render the stored Google Places attributes as a plain-English signal list the
 * model can weave in (dog/kid/group/outdoor/live-music/etc.). Only includes
 * attributes Google actually returned.
 */
function attributesBlock(attrs: Record<string, unknown> | null): string {
  if (!attrs) return "(no Places attributes on file)";
  const label: Record<string, [string, string]> = {
    allows_dogs: ["dogs welcome", "no dogs"],
    good_for_children: ["good for kids", "not really a kids' spot"],
    good_for_groups: ["handles groups", ""],
    outdoor_seating: ["has outdoor seating", ""],
    serves_beer: ["serves beer", ""],
    serves_wine: ["serves wine", ""],
    serves_cocktails: ["full cocktails", ""],
    live_music: ["hosts live music", ""],
    menu_for_children: ["has a kids' menu", ""],
    reservable: ["takes reservations", "no reservations"],
  };
  const out: string[] = [];
  if (typeof attrs.primary_type === "string") out.push(`type: ${attrs.primary_type}`);
  for (const [key, [yes, no]] of Object.entries(label)) {
    if (attrs[key] === true && yes) out.push(yes);
    else if (attrs[key] === false && no) out.push(no);
  }
  if (Array.isArray(attrs.parking) && attrs.parking.some((p) => String(p).startsWith("free")))
    out.push("free parking");
  return out.length ? out.join("; ") : "(no usable Places attributes)";
}

/** Fetch up to 3 recent review snippets (live, transient — never stored). */
async function fetchReviewSnippets(placeId: string | null): Promise<string[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!placeId || !key) return [];
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "reviews.text,reviews.rating" },
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { reviews?: { text?: { text?: string } }[] };
    return (d.reviews ?? [])
      .map((r) => r.text?.text?.replace(/\s+/g, " ").trim() ?? "")
      .filter(Boolean)
      .slice(0, 3)
      .map((t) => t.slice(0, 320));
  } catch {
    return [];
  }
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

const BANNED = [
  "discover", "explore", "your gateway", "nestled in", "charming", "hidden gem",
  "something for everyone", "experience the magic", "step back in time",
  "moreover", "furthermore", "it's worth noting",
  // Internal tooling must never leak into public copy (see hard rule above).
  "knowledge base", "my notes", "public info", "the data",
];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY env var is required.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  let query = supabaseAdmin
    .from("hwy4_venues")
    .select("venue_key, canonical, town, address, blurb, blurb_draft, place_id, places_attributes")
    .order("venue_key");
  if (explicitKeys.length > 0) {
    query = query.in("venue_key", explicitKeys);
  } else if (QUEUE) {
    // Only venues with no published blurb, no pending draft, and that have never
    // been drafted before (blurb_draft_at NULL) AND a resolved Places listing (so
    // the draft is grounded). Idempotent: re-running never re-drafts a venue that
    // already has a draft awaiting review, and a human's discard keeps
    // blurb_draft_at set so we don't re-propose one they declined.
    query = query
      .is("blurb", null)
      .is("blurb_draft", null)
      .is("blurb_draft_at", null)
      .not("place_id", "is", null);
  } else if (!ALL) {
    query = query.is("blurb", null);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load venues:", error.message);
    process.exit(1);
  }
  const venues = ((data ?? []) as VenueRow[]).slice(0, LIMIT);

  if (venues.length === 0) {
    console.log("No venues to draft (all have blurbs? try --all or pass venue keys).");
    return;
  }

  console.log(
    `${APPLY ? "APPLY" : OUT_FILE ? "PROPOSE" : "DRY RUN"}${
      QUEUE ? " (queue → blurb_draft, pending review)" : ""
    } — drafting ${venues.length} venue blurb(s) with Opus.\n`
  );

  const proposals: { venue_key: string; canonical: string; blurb: string; has_source: boolean }[] = [];

  for (const v of venues) {
    const reviews = await fetchReviewSnippets(v.place_id);
    const userPrompt = `Write the blurb for this venue:
- Name: ${v.canonical}
- Town: ${v.town}, California${v.address ? `\n- Address: ${v.address}` : ""}

=== GOOGLE PLACES SIGNALS (factual — safe to state directly) ===
${attributesBlock(v.places_attributes)}

=== RECENT VISITOR REVIEWS (for vibe + named specifics only — do NOT quote, do NOT invent hours/cadence from these) ===
${reviews.length ? reviews.map((r, i) => `${i + 1}. ${r}`).join("\n") : "(none available)"}

=== LOCAL KNOWLEDGE BASE (primary source for owners, history, named specifics) ===
${knowledgeBase}

=== ABOUT PAGE (voice reference, match this tone) ===
${aboutPage}

Lean on the Places signals for practical persona facts (dogs, kids, groups, outdoor, live music) — those are verified, so state them plainly. Use reviews only to sense the vibe and surface real named details (a dish, a feature); never quote a review or lift a star rating into the prose. Output the JSON object now.`;

    let blurb = "";
    let hasSource = false;
    try {
      const res = await client.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 600,
        system: withVoice(SYSTEM_PROMPT),
        messages: [{ role: "user", content: userPrompt }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const parsed = JSON.parse(stripFences(text)) as { blurb: string; has_source: boolean };
      blurb = (parsed.blurb ?? "").trim();
      hasSource = !!parsed.has_source;
    } catch (err) {
      console.error(`  ✗ ${v.venue_key}: generation/parse failed`, err);
      continue;
    }

    const emDashes = (blurb.match(/—/g) || []).length;
    const lower = blurb.toLowerCase();
    const violations = BANNED.filter((b) => lower.includes(b));

    console.log(`\n● ${v.canonical} (${v.venue_key})`);
    console.log(`  ${blurb}`);
    if (!hasSource) console.log(`  ⚠️  thin knowledge-base coverage — verify before publish`);
    if (emDashes > 0) console.log(`  ⚠️  ${emDashes} em dash(es) — rewrite before publish`);
    if (violations.length > 0) console.log(`  ⚠️  banned phrase(s): ${violations.join(", ")}`);

    proposals.push({ venue_key: v.venue_key, canonical: v.canonical, blurb, has_source: hasSource });

    if (APPLY) {
      // Don't auto-write a blurb that trips a hard voice rule; leave it for review.
      if (emDashes > 0 || violations.length > 0) {
        console.log(`  ↳ skipped write (voice-rule violation)`);
        continue;
      }
      const now = new Date().toISOString();
      // Queue mode stages a PENDING draft for review at /admin/venues and never
      // touches the published `blurb` (the accuracy contract: a machine drafts,
      // a human publishes). Default mode writes the published blurb directly
      // (the original review-in-chat workflow).
      const patch = QUEUE
        ? { blurb_draft: blurb, blurb_draft_at: now, updated_at: now }
        : { blurb, blurb_generated_at: now, updated_at: now };
      const { error: upErr } = await supabaseAdmin
        .from("hwy4_venues")
        .update(patch)
        .eq("venue_key", v.venue_key);
      if (upErr) console.error(`  ✗ write failed: ${upErr.message}`);
      else console.log(QUEUE ? `  ✓ queued draft for review` : `  ✓ written`);
    }
  }

  if (OUT_FILE) {
    writeFileSync(OUT_FILE, JSON.stringify(proposals, null, 2));
    console.log(`\nWrote ${proposals.length} proposals to ${OUT_FILE} (nothing written to DB).`);
  } else if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to write blurbs.`);
  }
}

main().catch((err) => {
  console.error("Draft failed:", err);
  process.exit(1);
});
