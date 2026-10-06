import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { beginOrganizerRun } from "../lib/organizer-source.js";
import { writeOrganizerBatch } from "../lib/organizer-source-exec.js";
import { applyVenueDetection } from "../lib/venue-matcher.js";
import { classifyEventCategory } from "../../lib/categorize.js";
import {
  PROSPECT_CMS_PAGE_URL,
  PROSPECT_PAGE_URL,
  PROSPECT_TOWN,
  PROSPECT_VENUE_NAME,
  featuredEventIds,
  mapProspectProduct,
  squareProductsUrl,
  type ProspectShow,
} from "../lib/prospect-772.js";

/**
 * Prospect 772 Winery — the venue's own Square Online calendar.
 *
 * WHY (issue #359, 2026-10-06). GoCalaveras is the only ingest today, and it
 * titles these nights "Live Music @ Prospect 772" with `artists` null and no
 * end time. The winery's calendar names the band, states 5–9pm, and sells a
 * ticket. Parsing lives in scripts/lib/prospect-772.ts.
 *
 * Deliberately NOT blocklisted in manual-sources.ts. GoCalaveras still
 * discovers shows the featured block has not picked up yet, and dropping
 * those would lose coverage. This scraper is registered LAST in
 * SPECIAL_SCRAPERS so it writes after GoCalaveras.
 *
 * How a row merges, checked against the live Oct 10 / Oct 24 rows: the Square
 * product id is not GoCalaveras's EventON id, and the titled name's dedup_key
 * is not the generic title's key, so the first pass misses both exact lookups
 * and hits `isSameEvent` (same venue_key, same date, same 17:00 start; the
 * generic title is a placeholder, and the hand-retitled rows already carry
 * the act). `buildStrongMatchUpdate` then writes the titled name, the 21:00
 * end, the price, and the ticket URL onto that row. A later GoCalaveras pass
 * of the generic title matches the same row and `placeholderNameSteal` keeps
 * the specific name. No stale sweep: the featured block is not a full
 * calendar, so a show dropping off it is not the venue retracting it.
 *
 * org_slug is `prospect-772`. `fk_hwy4_events_org` requires a `hwy4_orgs` row
 * with that slug before an INSERT succeeds. A merge into an existing
 * GoCalaveras row is an UPDATE and does not need it. As of 2026-10-06 that
 * org row does not exist, and this change does not add a migration.
 */

const SOURCE_NAME = "Prospect 772";
const ORG_SLUG = "prospect-772";
const UA = "Hwy4EventsBot/1.0 (+https://hwy4events.com)";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Prospect 772 fetch failed HTTP ${res.status} ${url}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Prospect 772 fetch returned non-JSON (HTTP ${res.status}) ${url}`);
  }
}

function toExtracted(show: ProspectShow): ExtractedEvent {
  return decodeEventFields({
    name: show.name,
    description: show.description,
    date: show.date,
    start_time: show.startTime,
    end_time: show.endTime,
    venue_name: PROSPECT_VENUE_NAME,
    town: PROSPECT_TOWN,
    address: null,
    category: classifyEventCategory(`${show.name} live music concert`, show.description),
    price: show.price,
    artists: [show.act],
    event_url: show.eventUrl,
    image_url: show.imageUrl,
    source_event_id: show.sourceEventId,
    // Structured start_date outranks anything a product slug might say later.
    date_authoritative: true,
  });
}

export async function scrapeProspect772(): Promise<void> {
  const run = beginOrganizerRun({
    title: "Prospect 772 (Square Online events)",
    sourceName: SOURCE_NAME,
    orgSlug: ORG_SLUG,
    pageUrl: PROSPECT_PAGE_URL,
  });

  const page = await fetchJson(PROSPECT_CMS_PAGE_URL);
  const ids = featuredEventIds(page);
  console.log(`Featured events on the calendar: ${ids.length}`);
  if (ids.length === 0) {
    console.log("No featured events. Nothing to write.");
    return;
  }

  const body = await fetchJson(squareProductsUrl(ids));
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) {
    throw new Error("Prospect 772 products response has no data array");
  }

  const byId = new Map<string, unknown>();
  for (const product of data) {
    if (product && typeof product === "object" && typeof (product as { id?: unknown }).id === "string") {
      byId.set((product as { id: string }).id, product);
    }
  }

  const shows: ProspectShow[] = [];
  for (const id of ids) {
    const product = byId.get(id);
    if (!product) {
      console.log(`  skipped (not in the products response): ${id}`);
      continue;
    }
    const show = mapProspectProduct(product);
    if (!show) {
      const name =
        product && typeof product === "object" && typeof (product as { name?: unknown }).name === "string"
          ? (product as { name: string }).name
          : id;
      console.log(`  skipped (unparsed event product): "${name}"`);
      continue;
    }
    shows.push(show);
  }

  const events = shows.map(toExtracted);
  for (const event of events) applyVenueDetection(event);

  const future = events.filter((e) => e.date >= run.today);
  const past = events.length - future.length;
  if (past > 0) console.log(`  Skipped ${past} past show(s)`);

  for (const e of future) {
    console.log(
      `  - ${e.date} ${e.start_time ?? "?"}-${e.end_time ?? "?"} | ${e.name} | ${e.price ?? "no price"}`
    );
  }

  const { upsert, written } = await writeOrganizerBatch(run, { events: future });
  if (written === 0) {
    console.log("No future shows to upsert.");
    return;
  }

  console.log("\n=== Prospect 772 Summary ===");
  console.log(`Featured ids: ${ids.length}`);
  console.log(`Mapped to events: ${shows.length}`);
  console.log(`Future shows: ${future.length}`);
  console.log(`Inserted: ${upsert.inserted}`);
  console.log(`Updated: ${upsert.updated}`);
  console.log(`Unchanged: ${upsert.unchanged}`);
  console.log(`Merged: ${upsert.skippedFuzzy}`);
}
