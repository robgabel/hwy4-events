// Email-to-event ingestion — the pure, network-free core (PRD-email-ingest.md).
//
// Everything here is deterministic and side-effect-free so it can be unit-tested
// without a model call or a database (scripts/test/inbound-email.test.ts). The
// route (app/api/inbound-email/route.ts) owns the impure parts: provider
// signature check, Storage upload, the Anthropic call, and the DB writes. It
// hands the model's text to `parseExtractedEvents` and each raw event to
// `normalizeExtracted`, then inserts a pending `event_submissions` row.
//
// Dedup is NOT done here: an email submission rides the existing Agent Cockpit
// Stage 1 engine — the same `triageSubmissionById` that analyzes form
// submissions (dup check via the shared isSameEvent + web research) runs on it,
// and the same /admin/submissions publish / reversible-merge actions decide it.

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeTime } from "./event-identity";
import { TOWNS } from "./towns";

export const EVENT_CATEGORIES = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "games",
  "other",
] as const;
export type ExtractedCategory = (typeof EVENT_CATEGORIES)[number];

export type ExtractionConfidence = "high" | "medium" | "low";

/** A normalized, validated event ready to become an event_submissions row. */
export interface NormalizedEvent {
  name: string;
  date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM
  end_time: string | null; // HH:MM
  venue_name: string | null;
  town: string | null; // canonical corridor town when recognized, else the raw string
  description: string | null;
  category: ExtractedCategory;
  artists: string[] | null;
  price: string | null;
  confidence: ExtractionConfidence;
}

// ─── Extraction prompt ──────────────────────────────────────────────────────

/** The system/extraction instructions handed to Claude alongside the email text
 *  and any poster image(s). Mirrors the scrape-bls/moose-lodge prompts: strict
 *  JSON, the 8 categories, "describe WHAT not WHERE", and an explicit escape
 *  hatch (empty array) when the email isn't a corridor event. */
/** Describes where a block of text came from, so one extraction contract can
 *  serve several front doors. Defaults to the email wording used by
 *  app/api/inbound-email/route.ts. */
export interface ExtractionContext {
  /** Singular noun for the text, used in the intro and the escape-hatch rule
   *  ("If the <noun> contains no determinable corridor event…"). */
  noun: string;
  /** Opening sentence describing the provenance (before the towns list). */
  intro: string;
  /** How the intro continues after the towns list. */
  introTail: string;
  /** Label for the optional header line, e.g. "Email subject" / "Group". */
  headerLabel: string;
  /** Label for the content block, e.g. "Email body" / "Post text". */
  bodyLabel: string;
}

export const EMAIL_EXTRACTION_CONTEXT: ExtractionContext = {
  noun: "email",
  intro: "You are reading an email a local sent to a community events site for the Highway 4 corridor in California",
  introTail:
    "The email may be a forward, may be terse, and the real details may live only in an attached poster image or PDF. Extract every distinct real-world event you can confirm.",
  headerLabel: "Email subject",
  bodyLabel: "Email body",
};

/** The corridor extraction contract: the JSON shape, the eight categories, and
 *  the never-invent-a-date rules. Defined ONCE and shared by every front door
 *  that turns free text into a pending submission (inbound email, Facebook
 *  group posts), so the rules cannot drift between them. */
export function buildExtractionContract(today: string, noun: string): string {
  const towns = TOWNS.join(", ");
  return `Today is ${today}. Resolve relative dates ("this Saturday", "next Friday") against it. Assume the current year when a flyer omits it.

Return ONLY a JSON array (no markdown fences, no prose). One object per event:
[
  {
    "name": "event title, concise, title case",
    "date": "YYYY-MM-DD",
    "start_time": "HH:MM" (24-hour) or null,
    "end_time": "HH:MM" or null,
    "venue_name": "the venue or place, or null",
    "town": one of [${towns}] or null if not determinable,
    "description": "1-2 plain sentences on what it is, or null",
    "category": "live_music|festival|civic|hike_walk|kids|wine|games|other",
    "artists": ["performer or band names"] or null,
    "price": "stated admission as written ($25, Free, Donation), or null",
    "confidence": "high|medium|low"
  }
]

Category guidance (describe WHAT the event is, not where it happens):
- live_music: concerts, bands, DJ sets, karaoke, open mics
- festival: large community celebrations, multi-activity holiday events
- civic: potlucks, meetings, talent shows, community gatherings, fundraisers
- hike_walk: guided hikes, nature/bird walks, trail runs
- kids: kid-focused activities, story times, camps
- wine: wine tastings, blending, sip-and-paint, vineyard events
- games: bingo, trivia, pool, bocce, cribbage, card tournaments
- other: car shows, sports, markets, anything else

Rules:
- Only include events in or near the corridor towns above. Omit anything clearly elsewhere.
- Do NOT invent a date. If you cannot determine a specific calendar date for an event, omit that event.
- Do NOT merge two different shows into one "X & Y" row; emit them separately.
- "confidence" is your own certainty the event is real and the fields are right.
- If the ${noun} contains no determinable corridor event, return exactly [].`;
}

/** The extraction instructions handed to Claude alongside the source text and
 *  any poster image(s). Mirrors the scrape-bls/moose-lodge prompts: strict
 *  JSON, the 8 categories, "describe WHAT not WHERE", and an explicit escape
 *  hatch (empty array) when the text isn't a corridor event.
 *
 *  `context` defaults to the email wording; pass another to reuse the identical
 *  contract for a different front door. */
export function buildExtractionPrompt(opts: {
  today: string;
  subject: string;
  body: string;
  context?: ExtractionContext;
}): string {
  const towns = TOWNS.join(", ");
  const ctx = opts.context ?? EMAIL_EXTRACTION_CONTEXT;
  return `${ctx.intro} (the towns: ${towns}). ${ctx.introTail}

${buildExtractionContract(opts.today, ctx.noun)}

${ctx.headerLabel}: ${opts.subject || "(none)"}

${ctx.bodyLabel}:
${opts.body || "(empty)"}`;
}

// ─── Parsing + normalization ────────────────────────────────────────────────

/** Strip a leading/trailing markdown fence (the model sometimes wraps JSON in
 *  ```json … ```), then JSON.parse and coerce to an array. Returns [] on any
 *  failure so a malformed model response degrades to "no events", never throws.
 *  Mirrors the fence-strip used in scrape-bls / scrape-moose-lodge. */
export function parseExtractedEvents(text: string): unknown[] {
  let json = (text ?? "").trim();
  if (json.startsWith("```")) {
    json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  // The model may emit a bare object or a leading sentence; salvage the array.
  if (!json.startsWith("[")) {
    const start = json.indexOf("[");
    const end = json.lastIndexOf("]");
    if (start !== -1 && end > start) json = json.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Lowercase-match an extracted town against the canonical corridor towns; map
 *  the one address-only alias. Unknown towns are kept verbatim (trimmed) so a
 *  human can correct them in the admin form rather than losing the value. */
export function canonicalizeTown(raw: unknown): string | null {
  const s = asString(raw);
  if (!s) return null;
  const lower = s.toLowerCase();
  const hit = TOWNS.find((t) => t.toLowerCase() === lower);
  if (hit) return hit;
  if (lower === "hathaway pines") return "Arnold";
  return s;
}

function normalizeCategory(raw: unknown): ExtractedCategory {
  const s = asString(raw)?.toLowerCase();
  return (EVENT_CATEGORIES as readonly string[]).includes(s ?? "")
    ? (s as ExtractedCategory)
    : "other";
}

function normalizeConfidence(raw: unknown): ExtractionConfidence {
  const s = asString(raw)?.toLowerCase();
  return s === "high" || s === "low" ? s : "medium";
}

function normalizeArtists(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map((a) => asString(a))
    .filter((a): a is string => !!a);
  return out.length ? out : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate + normalize one raw extracted object. Returns null when it lacks the
 *  two fields nothing downstream can proceed without: a name and a real date. */
export function normalizeExtracted(raw: unknown): NormalizedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const name = asString(o.name);
  const date = asString(o.date);
  if (!name || !date || !ISO_DATE.test(date)) return null;

  const start = normalizeTime(asString(o.start_time)) || null;
  const end = normalizeTime(asString(o.end_time)) || null;

  return {
    name,
    date,
    start_time: start,
    end_time: end,
    venue_name: asString(o.venue_name),
    town: canonicalizeTown(o.town),
    description: asString(o.description),
    category: normalizeCategory(o.category),
    artists: normalizeArtists(o.artists),
    price: asString(o.price),
    confidence: normalizeConfidence(o.confidence),
  };
}

// ─── Email-address + LIKE helpers (used by the route) ───────────────────────

/** Pull the bare address out of a From header value: "Rob <rob@x.com>" →
 *  "rob@x.com"; "rob@x.com" → "rob@x.com". Lowercased for allowlist matching. */
export function extractEmailAddress(from: string | null | undefined): string {
  if (!from) return "";
  const angle = from.match(/<([^>]+)>/);
  const raw = (angle ? angle[1] : from).trim().toLowerCase();
  return raw;
}

/** Escape a value for use inside a SQL LIKE pattern (the route gates idempotency
 *  with `source_message_id LIKE '<id>#%'`). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ─── Webhook signature (Svix / Standard Webhooks, as Resend signs) ──────────
//
// Resend signs inbound webhooks with the Standard Webhooks scheme (Svix):
// HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`, base64, keyed by
// the base64 body of the `whsec_…` secret. Hand-rolled with node:crypto so we
// add no dependency (matching the codebase's lean style); locked round-trip by
// the unit test.

function signingKey(secret: string): Buffer {
  return secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");
}

/** Compute the base64 signature for a webhook payload (also used by the test and
 *  the synthetic-payload e2e to forge a valid request). */
export function signWebhook(
  secret: string,
  id: string,
  timestamp: string,
  body: string
): string {
  return createHmac("sha256", signingKey(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
}

export interface WebhookVerifyInput {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null; // space-delimited "v1,<sig> v1,<sig2>"
  body: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}

/** Constant-time-verify a Standard Webhooks signature, with a timestamp-freshness
 *  window to blunt replay. Returns false on any missing/invalid input rather than
 *  throwing, so the route can answer a clean 401. */
export function verifyWebhookSignature(input: WebhookVerifyInput): boolean {
  const { secret, id, timestamp, signatureHeader, body, nowSeconds } = input;
  const tolerance = input.toleranceSeconds ?? 300;
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > tolerance) return false;

  const expected = Buffer.from(signWebhook(secret, id, timestamp, body));
  for (const part of signatureHeader.split(" ")) {
    if (!part) continue;
    const comma = part.indexOf(",");
    const sig = Buffer.from(comma === -1 ? part : part.slice(comma + 1));
    if (sig.length === expected.length && timingSafeEqual(sig, expected)) return true;
  }
  return false;
}
