import FirecrawlApp from "@mendable/firecrawl-js";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { TOWNS } from "../../lib/towns.js";

/**
 * American Red Cross blood-drive scraper.
 *
 * Why a hand-written scraper (not a FIRECRAWL_SOURCES config entry): the generic
 * runner assumes ONE venue per source (defaultVenue/defaultTown). Red Cross
 * drives have a DIFFERENT host facility and address per drive, and the town must
 * come from each drive's own result city. So this is a "many hosts from one
 * search" aggregator, the same shape as gocalaveras and visit-murphys.
 *
 * Source: the public drive-results page. It is a JavaScript SPA behind Akamai
 * bot-protection (a plain fetch returns 403), so we render + extract it through
 * Firecrawl — the same FIRECRAWL_API_KEY the other Firecrawl sources use. We ask
 * Firecrawl for structured JSON directly (no separate LLM extraction call), then
 * map each drive deterministically.
 *
 * Coverage: we search a few corridor ZIP anchors. The Red Cross "zipSponsor"
 * field accepts a ZIP or a sponsor code; passing a corridor ZIP returns drives
 * within the site's default radius. Cross-anchor duplicates and out-of-corridor
 * overspill (San Andreas, Sonora, etc.) are dropped downstream by the corridor
 * filter + dedup. Start with 3 anchors; add more ZIPs if drives show up
 * elsewhere in the corridor.
 */

const SOURCE_NAME = "American Red Cross";
const ORG_SLUG = "red-cross";

// Provenance URL stored on every row's source_url.
const PAGE_URL = "https://www.redcrossblood.org/give.html/find-drive";
const BASE = "https://www.redcrossblood.org/give.html/drive-results";

// Corridor ZIP anchors to search. Expand if drives appear in other towns.
const ANCHORS: Array<{ zip: string; label: string }> = [
  { zip: "95247", label: "Murphys" },
  { zip: "95222", label: "Angels Camp" },
  { zip: "95223", label: "Arnold" },
];

function searchUrl(zip: string): string {
  return `${BASE}?zipSponsor=${zip}`;
}

const HWY4_TOWNS = new Set(TOWNS.map((t) => t.toLowerCase()));

// ─── Firecrawl JSON extraction ──────────────────────────────────────────

interface RcDrive {
  host_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  date?: string; // prefer YYYY-MM-DD (asked in prompt)
  start_time?: string; // prefer 24h HH:MM
  end_time?: string; // prefer 24h HH:MM
}

const DRIVE_SCHEMA = {
  type: "object",
  properties: {
    drives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          host_name: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          zip: { type: "string" },
          date: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
        },
      },
    },
    no_drives_found: { type: "boolean" },
  },
};

const EXTRACT_PROMPT = `Extract every blood, platelet, or plasma donation drive listed on this American Red Cross drive-results page.

For each drive return:
- host_name: the sponsor / host facility name exactly as shown (e.g. "Native Daughters of the Golden West")
- address: the street address only (e.g. "268 Main St")
- city, state, zip: the location of the drive
- date: the drive date as YYYY-MM-DD
- start_time and end_time: 24-hour HH:MM

Only return drives actually listed on the page. Never invent a drive. If the page
shows no drives (empty results / "no drives found"), set no_drives_found to true
and return an empty drives array.`;

async function fetchDrives(
  firecrawl: FirecrawlApp,
  url: string
): Promise<RcDrive[]> {
  // The drive page is a JS SPA; give it time to render. schema is a plain JSON
  // Schema object — the SDK types want a Zod schema, but the API accepts JSON
  // Schema, and scripts/ is not type-checked (root tsconfig excludes it; CI runs
  // tsx without tsc). Cast keeps intent clear without pulling in zod.
  const params = {
    formats: ["json"],
    jsonOptions: { prompt: EXTRACT_PROMPT, schema: DRIVE_SCHEMA },
    waitFor: 9000,
    timeout: 60000,
    onlyMainContent: false,
  } as Parameters<typeof firecrawl.scrapeUrl>[1];

  try {
    const result = await firecrawl.scrapeUrl(url, params);
    if (!result.success) {
      console.warn(`  Firecrawl failed for ${url}:`, (result as { error?: string }).error ?? "unknown error");
      return [];
    }
    const payload = (result.json ?? {}) as {
      drives?: RcDrive[];
      no_drives_found?: boolean;
    };
    return Array.isArray(payload.drives) ? payload.drives : [];
  } catch (err) {
    console.warn(`  Error fetching ${url}:`, err);
    return [];
  }
}

// ─── Normalizers ────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05",
  june: "06", july: "07", august: "08", september: "09", october: "10",
  november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07",
  aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

/** Accepts "YYYY-MM-DD" or "Monday, June 15, 2026" → "YYYY-MM-DD" (or null). */
function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // "Monday, June 15, 2026" / "June 15, 2026" / "Jun 15 2026"
  const m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mm = MONTHS[m[1].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** Accepts "10:00", "10:00 AM", "3:00 PM" → 24h "HH:MM" (or null). */
function normalizeTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function titleCaseTown(city: string): string {
  const lower = city.trim().toLowerCase();
  const match = TOWNS.find((t) => t.toLowerCase() === lower);
  return match ?? city.trim();
}

function buildAddress(d: RcDrive): string | null {
  const street = d.address?.trim();
  const city = d.city?.trim();
  const state = d.state?.trim() || "CA";
  const zip = d.zip?.trim();
  if (!street && !city) return null;
  const cityPart = city
    ? `${city}, ${state}${zip ? ` ${zip}` : ""}`
    : `${state}${zip ? ` ${zip}` : ""}`;
  return street ? `${street}, ${cityPart}` : cityPart;
}

// Stable id so re-scrapes update the same row in place even if the display
// title changes later. Keyed on host + date + street (lowercased).
function sourceEventId(host: string, date: string, street: string): string {
  return `${host}|${date}|${street}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mapDrive(d: RcDrive, anchorZip: string): ExtractedEvent | null {
  const host = d.host_name?.trim();
  const date = normalizeDate(d.date);
  const city = d.city?.trim();
  if (!host || !date || !city) return null;

  const town = titleCaseTown(city);
  const street = d.address?.trim() ?? "";
  const driveZip = d.zip?.trim() || anchorZip;

  return {
    name: `Red Cross Blood Drive at ${host}`,
    description:
      `Give blood with the American Red Cross at ${host} in ${town}. ` +
      `Appointments are recommended; walk-ins are welcome. ` +
      `Book a time at RedCrossBlood.org or call 1-800-733-2767.`,
    date,
    start_time: normalizeTime(d.start_time),
    end_time: normalizeTime(d.end_time),
    venue_name: host,
    town,
    address: buildAddress(d),
    category: "civic",
    price: "Free",
    artists: null,
    // Land the donor on the Red Cross search for this drive's ZIP so they can
    // pick a time slot. (redcrossblood.org is exempt from URL validation — it
    // 403s bots but works for real users.)
    event_url: searchUrl(driveZip),
    image_url: null,
    source_event_id: sourceEventId(host, date, street),
  };
}

// ─── Main ───────────────────────────────────────────────────────────────

export async function scrapeRedCross(): Promise<void> {
  console.log("=== American Red Cross (blood drives) ===");

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY environment variable");
  }
  const firecrawl = new FirecrawlApp({ apiKey });
  const today = new Date().toISOString().slice(0, 10);

  // 1. Pull drives from each corridor anchor.
  const rawDrives: Array<{ drive: RcDrive; anchorZip: string }> = [];
  for (const anchor of ANCHORS) {
    const url = searchUrl(anchor.zip);
    console.log(`  Searching ${anchor.label} (${anchor.zip}) …`);
    const drives = await fetchDrives(firecrawl, url);
    console.log(`    found ${drives.length} drive(s)`);
    for (const drive of drives) rawDrives.push({ drive, anchorZip: anchor.zip });
  }

  // 2. Map → ExtractedEvent, decode entities.
  const mapped: ExtractedEvent[] = [];
  for (const { drive, anchorZip } of rawDrives) {
    const m = mapDrive(drive, anchorZip);
    if (m) mapped.push(decodeEventFields(m));
  }

  // 3. Keep corridor towns only (case-insensitive). Out-of-corridor overspill
  //    from the radius search is dropped here (belt) and again in upsert (suspenders).
  const corridor = mapped.filter((e) =>
    HWY4_TOWNS.has(e.town.toLowerCase().trim())
  );
  const droppedTowns = [
    ...new Set(
      mapped
        .filter((e) => !HWY4_TOWNS.has(e.town.toLowerCase().trim()))
        .map((e) => e.town)
    ),
  ];
  if (droppedTowns.length > 0) {
    console.log(`  Skipped non-corridor towns: ${droppedTowns.join(", ")}`);
  }

  // 4. Future only, then dedupe cross-anchor repeats by stable source id.
  const future = corridor.filter((e) => e.date >= today);
  const bySourceId = new Map<string, ExtractedEvent>();
  for (const e of future) {
    const key = e.source_event_id ?? `${e.name}|${e.date}|${e.town}`;
    if (!bySourceId.has(key)) bySourceId.set(key, e);
  }
  const deduped = [...bySourceId.values()];

  console.log(
    `\nTotal: ${mapped.length} mapped, ${corridor.length} in corridor, ` +
      `${future.length} future, ${deduped.length} after cross-anchor dedup`
  );
  for (const e of deduped) {
    console.log(`  - ${e.date} | ${e.town} | ${e.venue_name}`);
  }

  if (deduped.length === 0) {
    console.log("No future corridor blood drives to upsert.");
    // Still run the stale sweep so a now-empty corridor clears old rows.
    await sweepStale(today);
    return;
  }

  // 5. Upsert via the shared path (dedup_key + corridor drop + cross-source merge).
  const result: UpsertResult = await upsertEvents(
    deduped,
    SOURCE_NAME,
    ORG_SLUG,
    PAGE_URL
  );

  // 6. Force the green "Free" badge. cost_tier is normally set by the
  //    extract-prices cron, but that cron skips rows whose price is already set
  //    (ours is "Free"), so it would never run on these — set it directly.
  //    Stamping price_extracted_at keeps them out of that queue for good.
  const { error: tierErr } = await supabaseAdmin
    .from("hwy4_events")
    .update({
      cost_tier: "free",
      price: "Free",
      price_extracted_at: new Date().toISOString(),
    })
    .eq("org_slug", ORG_SLUG)
    .gte("date", today)
    .neq("cost_tier", "free");
  if (tierErr) console.warn("  cost_tier backfill failed:", tierErr.message);

  // 7. Stale sweep: drop future red-cross rows that fell off the Red Cross list
  //    (cancelled drives) and weren't refreshed this run within the grace window.
  const swept = await sweepStale(today);

  console.log("\n=== Red Cross Summary ===");
  console.log(`Anchors searched: ${ANCHORS.length}`);
  console.log(`Drives found (raw): ${rawDrives.length}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
  console.log(`Merged (cross-source): ${result.skippedFuzzy}`);
  console.log(`Swept (stale): ${swept}`);
}

/**
 * Delete future red-cross rows not refreshed within the grace window. Grace =
 * 10 daily scrapes of buffer so a single transient Firecrawl/extraction failure
 * never deletes real drives. Past drives are preserved as historical record.
 */
async function sweepStale(today: string): Promise<number> {
  const STALE_GRACE_DAYS = 10;
  const cutoff = new Date(
    Date.now() - STALE_GRACE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // A drive still on the Red Cross list was refreshed with a fresh
  // last_scraped_at this run, so anything older than the grace window (or never
  // stamped) is a drive that fell off the list.
  //
  // The .select() RETURNING list MUST include last_scraped_at: a DELETE that
  // filters a column via .or() but omits that column from the returned columns
  // errors "column does not exist" in PostgREST. Same idiom as the sweep in
  // app/api/scrape-moose-lodge/route.ts.
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .delete()
    .eq("org_slug", ORG_SLUG)
    .gte("date", today)
    .or(`last_scraped_at.is.null,last_scraped_at.lt.${cutoff}`)
    .select("id, name, date, last_scraped_at");

  if (error) {
    console.warn("  Stale sweep failed:", error.message);
    return 0;
  }
  if (data && data.length > 0) {
    console.log(
      `  Swept ${data.length} stale row(s):`,
      data.map((r) => `${r.date} ${r.name}`).join(", ")
    );
  }
  return data?.length ?? 0;
}
