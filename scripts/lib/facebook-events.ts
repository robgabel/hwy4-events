import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedEvent } from "./extract.js";
import { decodeEventFields } from "./extract.js";
import { applyVenueDetection } from "./venue-matcher.js";

/**
 * Facebook Events Discover scraper.
 *
 * Different from ./facebook.ts (which uses apify/facebook-posts-scraper against
 * a specific Page). This module uses apify/facebook-events-scraper, which
 * accepts a search URL (with a location_id filter) and returns structured
 * event objects from any Page that has tagged that location.
 *
 * Use this to surface long-tail community events that aren't on Pages we
 * already track individually.
 */

const APIFY_ENDPOINT =
  "https://api.apify.com/v2/acts/apify~facebook-events-scraper/run-sync-get-dataset-items";

const VALID_CATEGORIES = [
  "live_music",
  "festival",
  "civic",
  "resort",
  "lodge",
  "other",
] as const;
type Category = (typeof VALID_CATEGORIES)[number];

export interface TownLocationConfig {
  /** Slug used for org_slug column (e.g. "fb-discover-arnold"). */
  orgSlug: string;
  /** Display label used for source_name (e.g. "Arnold"). */
  label: string;
  /** Canonical town value used as fallback when FB address doesn't disambiguate. */
  defaultTown: string;
  /** Facebook place ID for this town. */
  locationId: string;
  /** Slug used in the /events/explore/<slug>/<id> URL (e.g. "arnold-ca"). */
  exploreSlug: string;
}

/**
 * Raw Apify event shape (subset we care about).
 * Field names match the actual Apify response from apify/facebook-events-scraper.
 */
interface ApifyEvent {
  id?: string;
  name?: string;
  description?: string;
  /** Canonical event URL like "https://www.facebook.com/events/<id>/". */
  url?: string;
  /** ISO UTC timestamp, e.g. "2026-06-07T02:00:00.000Z". */
  utcStartDate?: string;
  /** Human-readable date sentence, often includes end time. */
  dateTimeSentence?: string;
  /** Location object — can be null for online-only events. */
  location?: {
    name?: string;
    address?: string;
    contextualName?: string;
    streetAddress?: string;
    city?: string;
    state?: string;
    countryCode?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  /** Organizer string like "Event by Bistro Espresso". */
  organizedBy?: string;
  paidContent?: boolean;
  ticketsInfo?: unknown;
  isOnline?: boolean;
  isPast?: boolean;
  isCanceled?: boolean;
  imageUrl?: string;
  [key: string]: unknown;
}

interface ApifyRunResult {
  failed: boolean;
  error?: string;
  count: number;
}

const fbDiscoverStatus: Record<string, ApifyRunResult> = {};

export function getFacebookDiscoverStatus(): Record<string, ApifyRunResult> {
  return { ...fbDiscoverStatus };
}

/**
 * Build the explore URL for a given town.
 *
 * The plain "/events/?location_id=X" URL does NOT geo-filter when scraped
 * unauthenticated — it returns global online events. The "/events/explore/<slug>/<id>"
 * variant correctly returns events tagged at that location.
 */
function buildExploreUrl(config: TownLocationConfig): string {
  return `https://www.facebook.com/events/explore/${config.exploreSlug}/${config.locationId}`;
}

/**
 * Run the Apify facebook-events-scraper actor for one town.
 */
async function callApify(
  config: TownLocationConfig,
  maxEvents: number
): Promise<ApifyEvent[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("Missing APIFY_API_TOKEN environment variable");
  }

  const startUrl = buildExploreUrl(config);
  console.log(`  Apify input: ${startUrl}`);

  const response = await axios.post(
    APIFY_ENDPOINT,
    {
      startUrls: [startUrl],
      maxEvents,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      // Apify sync runs can take a while when crawling FB
      timeout: 180000,
    }
  );

  if (!Array.isArray(response.data)) {
    console.warn(`  Apify returned unexpected response type: ${typeof response.data}`);
    return [];
  }

  return response.data as ApifyEvent[];
}

/**
 * Convert a UTC ISO timestamp to America/Los_Angeles local date + time.
 * All Hwy 4 events are in Pacific time; FB returns UTC.
 *
 * Example: "2026-06-07T02:00:00.000Z" → { date: "2026-06-06", time: "19:00" }
 */
function utcToPacific(iso: string | undefined): { date: string | null; time: string | null } {
  if (!iso) return { date: null, time: null };
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { date: null, time: null };
    // en-CA gives YYYY-MM-DD; 24h time format
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return { date, time };
  } catch {
    return { date: null, time: null };
  }
}

/**
 * Try to extract an end time from FB's dateTimeSentence.
 * Examples:
 *   "Sat, Jun 20 at 10:00 AM – 11:30 AM EDT"  → "11:30"
 *   "Friday 22 May 2026 from 19:00-21:00 -04" → "21:00"
 *   "Thursday, May 21, 2026 at 10:00 AM AST"  → null (no range)
 *
 * Note: the returned time is the raw value from the sentence; we don't shift
 * timezone here because the sentence's stated zone may differ from PT.
 * If unsure, return null and let the event display only the start time.
 */
function parseEndTimeFromSentence(sentence: string | undefined, startTime: string | null): string | null {
  if (!sentence || !startTime) return null;
  // Match "HH:MM AM/PM – HH:MM AM/PM" or "HH:MM-HH:MM"
  const rangeMatch =
    sentence.match(/(\d{1,2}:\d{2})\s*(AM|PM)?\s*[–-]\s*(\d{1,2}:\d{2})\s*(AM|PM)?/i);
  if (!rangeMatch) return null;
  const endHHMM = rangeMatch[3];
  const endMeridiem = rangeMatch[4]?.toUpperCase();
  if (endMeridiem) {
    const [hStr, mStr] = endHHMM.split(":");
    let h = parseInt(hStr, 10);
    if (endMeridiem === "PM" && h < 12) h += 12;
    if (endMeridiem === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${mStr}`;
  }
  // Already 24h
  return endHHMM;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Strip the "Event by " prefix from organizedBy to get just the organizer name.
 */
function organizerName(organizedBy: string | undefined): string | null {
  if (!organizedBy) return null;
  return organizedBy.replace(/^Event by\s+/i, "").trim() || null;
}

/**
 * Returns true if a string looks like a street address rather than a venue
 * name (starts with a number, contains a comma — e.g. "1225 Oak Cir, Arnold, CA").
 */
function looksLikeAddress(s: string | undefined): boolean {
  if (!s) return false;
  return /^\s*\d/.test(s) && s.includes(",");
}

/**
 * Resolve venue name from Apify event, falling back to organizer or default.
 * Skips location.name when it looks like a raw street address — in that case
 * the organizer name is a better human-readable venue label.
 */
function resolveVenueName(e: ApifyEvent, fallbackLabel: string): string {
  const locName = e.location?.name;
  if (locName && !looksLikeAddress(locName)) return locName.trim();
  return organizerName(e.organizedBy) || pickString(locName) || fallbackLabel;
}

/**
 * Resolve a usable address string. Prefers full street address, then
 * the location name (when it looks address-like), then contextualName.
 */
function resolveAddress(e: ApifyEvent): string | null {
  const loc = e.location;
  if (!loc) return null;
  // FB sometimes puts the street address in `name` when there's no separate
  // place record (e.g. "1225 Oak Cir, Arnold, CA 95223-9406, United States")
  if (loc.name && /\d/.test(loc.name) && loc.name.includes(",")) {
    return loc.name;
  }
  return (
    pickString(loc.streetAddress) ||
    pickString(loc.address) ||
    pickString(loc.contextualName)
  );
}

/**
 * Pick the best town value from FB address/contextualName, defaulting to
 * the configured town for the location.
 */
function resolveTown(e: ApifyEvent, defaultTown: string): string {
  const haystack = [
    e.location?.name,
    e.location?.address,
    e.location?.streetAddress,
    e.location?.contextualName,
    e.location?.city,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
  if (!haystack) return defaultTown;
  const HWY4_TOWNS = [
    "Angels Camp",
    "Copperopolis",
    "Murphys",
    "Arnold",
    "Avery",
    "Camp Connell",
    "Bear Valley",
    "Dorrington",
    "White Pines",
    "Hathaway Pines",
  ];
  for (const town of HWY4_TOWNS) {
    if (haystack.includes(town.toLowerCase())) return town;
  }
  return defaultTown;
}

function inferPrice(e: ApifyEvent): string | null {
  if (e.paidContent === true) return "Paid";
  // Don't claim "Free" — FB's paidContent=false just means not gated by FB
  // paywall, not that the actual event has no cover charge.
  return null;
}

/**
 * Map one Apify event to our ExtractedEvent shape.
 * Returns null if required fields are missing (no date, no name) or if the
 * event is online-only with no physical Hwy 4 location.
 */
function mapApifyEvent(
  e: ApifyEvent,
  config: TownLocationConfig
): ExtractedEvent | null {
  const name = pickString(e.name);
  if (!name) return null;
  if (e.isCanceled === true || e.isPast === true) return null;
  // Skip online-only events with no physical location — they're not actually
  // local even when the discover URL surfaces them.
  if (e.isOnline === true && !e.location) return null;

  const { date, time: startTime } = utcToPacific(e.utcStartDate);
  if (!date) return null;

  const endTime = parseEndTimeFromSentence(e.dateTimeSentence, startTime);

  const description = pickString(e.description)?.slice(0, 1000) || null;
  const address = resolveAddress(e);
  const town = resolveTown(e, config.defaultTown);
  const venueName = resolveVenueName(e, `${config.label} Community`);

  const eventUrl =
    pickString(e.url) ||
    (e.id ? `https://www.facebook.com/events/${e.id}/` : null);

  return {
    name,
    description,
    date,
    start_time: startTime,
    end_time: endTime,
    venue_name: venueName,
    town,
    address,
    category: "other",
    price: inferPrice(e),
    artists: null,
    event_url: eventUrl,
    source_event_id: pickString(e.id) ?? null,
  };
}

/**
 * Use Haiku to assign a category to each event in a batch.
 * Cheaper than per-event extraction — one call covers all events for a town.
 */
async function classifyCategoriesBatch(
  events: ExtractedEvent[]
): Promise<ExtractedEvent[]> {
  if (events.length === 0) return events;

  const client = new Anthropic();
  const items = events.map((e, i) => ({
    i,
    name: e.name,
    desc: (e.description || "").slice(0, 200),
    venue: e.venue_name,
  }));

  const prompt = `Classify each event below into ONE category:
- live_music: concerts, bands, DJs, live performances, open mics, karaoke
- festival: multi-day or large outdoor festivals, fairs, parades
- civic: community gatherings, meetings, charity, fundraisers, town hall, school events
- resort: events hosted at ski/resort properties (Bear Valley Mountain Resort, etc.)
- lodge: events at lodges, inns, or members-only clubs (Lodge, Elks, HOA, country club)
- other: anything else (workshops, markets, sports, etc.)

Return ONLY a JSON array of {i: number, category: string} — one entry per event.

Events:
${JSON.stringify(items, null, 2)}`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return events;

    const byIndex = new Map<number, string>();
    for (const item of parsed) {
      if (typeof item?.i === "number" && typeof item?.category === "string") {
        byIndex.set(item.i, item.category);
      }
    }

    return events.map((e, i) => {
      const cat = byIndex.get(i);
      if (cat && (VALID_CATEGORIES as readonly string[]).includes(cat)) {
        return { ...e, category: cat as Category };
      }
      return e;
    });
  } catch (err: any) {
    console.warn(`  Category classification failed: ${err?.message || err}. Keeping "other".`);
    return events;
  }
}

/**
 * Fetch and parse events for one town via Apify FB events discover.
 *
 * @param config       Town config (slug, label, defaultTown, locationId)
 * @param maxEvents    Apify maxEvents cap (default 50)
 * @returns            ExtractedEvent[] ready to feed into upsertEvents
 */
export async function fetchFacebookDiscoverEvents(
  config: TownLocationConfig,
  maxEvents: number = 50
): Promise<ExtractedEvent[]> {
  console.log(`  Fetching FB events for ${config.label} (location_id=${config.locationId})`);

  let raw: ApifyEvent[];
  try {
    raw = await callApify(config, maxEvents);
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if (err?.response?.data) {
      console.warn(`  Apify error response:`, JSON.stringify(err.response.data).slice(0, 500));
    }
    console.warn(`  Apify scrape failed for ${config.label}: ${errorMsg}`);
    fbDiscoverStatus[config.orgSlug] = { failed: true, error: errorMsg, count: 0 };
    return [];
  }

  console.log(`  Apify returned ${raw.length} raw events`);

  const mapped: ExtractedEvent[] = [];
  for (const e of raw) {
    const m = mapApifyEvent(e, config);
    if (m) mapped.push(m);
  }
  console.log(`  Mapped ${mapped.length} events (dropped ${raw.length - mapped.length} for missing name/date)`);

  if (mapped.length === 0) {
    fbDiscoverStatus[config.orgSlug] = { failed: false, count: 0 };
    return [];
  }

  // Decode HTML entities, then apply venue detection to canonicalize known venues
  const decoded = mapped.map(decodeEventFields);
  for (const event of decoded) {
    if (applyVenueDetection(event)) {
      console.log(`  Venue detected: "${event.venue_name}" from "${event.name}"`);
    }
  }

  // Batch-classify categories with one Haiku call
  const classified = await classifyCategoriesBatch(decoded);

  fbDiscoverStatus[config.orgSlug] = { failed: false, count: classified.length };
  return classified;
}
