import {
  scrapeFbEventListFromPage,
  scrapeFbEvent,
  EventType,
  type ShortEventData,
  type EventData,
} from "facebook-event-scraper";
import type { ExtractedEvent } from "./extract.js";
import type { VenueContext } from "./extract.js";

/** Track Facebook scraper failures per page across a single scrape run. */
const fbFailures: Record<string, { failed: boolean; error?: string }> = {};

/**
 * Returns a summary of which Facebook pages failed during this scrape run.
 * Used by the health check to detect persistent Facebook breakage.
 */
export function getFacebookStatus(): Record<string, { failed: boolean; error?: string }> {
  return { ...fbFailures };
}

/**
 * Validate that a ShortEventData has the fields we expect.
 * If facebook-event-scraper breaks due to Facebook HTML changes,
 * these will be missing or wrong.
 */
function isValidShortEvent(event: unknown): event is ShortEventData {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    typeof e.url === "string" &&
    e.id.length > 0 &&
    e.url.includes("facebook.com")
  );
}

/**
 * Validate that a full EventData has the critical fields we need.
 */
function isValidFullEvent(event: unknown): event is EventData {
  if (!event || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e.name === "string" &&
    e.name.length > 0 &&
    typeof e.startTimestamp === "number" &&
    e.startTimestamp > 0 &&
    typeof e.url === "string"
  );
}

/**
 * Map a Facebook event category label to our category enum.
 */
function mapCategory(fbCategories: EventData["categories"]): string {
  if (!Array.isArray(fbCategories)) return "other";
  const labels = fbCategories.map((c) => c.label.toLowerCase());
  if (labels.some((l) => l.includes("music") || l.includes("concert"))) {
    return "live_music";
  }
  if (labels.some((l) => l.includes("festival"))) {
    return "festival";
  }
  if (labels.some((l) => l.includes("community") || l.includes("civic"))) {
    return "civic";
  }
  return "other";
}

/**
 * Convert a Facebook EventData to our ExtractedEvent format.
 */
function toExtractedEvent(
  fb: EventData,
  venue: VenueContext
): ExtractedEvent {
  const start = new Date(fb.startTimestamp * 1000);
  const end = fb.endTimestamp ? new Date(fb.endTimestamp * 1000) : null;

  const date = start.toISOString().slice(0, 10);
  const startTime = start.toTimeString().slice(0, 5); // HH:MM
  const endTime = end ? end.toTimeString().slice(0, 5) : null;

  // Use Facebook location if available, otherwise venue defaults
  const venueName = fb.location?.name || venue.defaultVenue;
  const address =
    fb.location?.address || venue.defaultAddress || null;

  return {
    name: fb.name,
    description: fb.description?.slice(0, 500) || null,
    date,
    start_time: startTime,
    end_time: endTime,
    venue_name: venueName,
    town: venue.defaultTown,
    address,
    category: mapCategory(fb.categories),
    price: null, // Facebook doesn't expose price in a structured way
    artists: null,
    event_url: fb.ticketUrl || fb.url,
  };
}

/**
 * Fetch upcoming events from a Facebook Page and return them as ExtractedEvent[].
 *
 * @param pageUrl - Full Facebook page URL (e.g. "https://www.facebook.com/bricestation/")
 * @param venue  - Default venue context for the page
 * @returns Array of extracted events, or empty array on failure
 */
export async function fetchFacebookEvents(
  pageUrl: string,
  venue: VenueContext
): Promise<ExtractedEvent[]> {
  // Strip trailing slash — the library's regex rejects URLs ending with /
  const normalizedUrl = pageUrl.replace(/\/+$/, "");
  console.log(`  Fetching Facebook events from: ${normalizedUrl}`);

  let shortEvents: unknown[];
  try {
    shortEvents = await scrapeFbEventListFromPage(
      normalizedUrl,
      EventType.Upcoming
    );
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.warn(`  Facebook event list scrape failed: ${errorMsg}`);
    fbFailures[pageUrl] = { failed: true, error: errorMsg };
    return [];
  }

  if (!Array.isArray(shortEvents)) {
    console.warn(`  Facebook returned unexpected response type: ${typeof shortEvents}`);
    fbFailures[pageUrl] = { failed: true, error: `Unexpected response type: ${typeof shortEvents}` };
    return [];
  }

  // Validate response shape — detect if facebook-event-scraper is broken
  const validShort = shortEvents.filter(isValidShortEvent);
  if (shortEvents.length > 0 && validShort.length === 0) {
    console.warn(
      `  Facebook returned ${shortEvents.length} events but none have valid shape. ` +
      `The scraper may be broken due to Facebook HTML changes.`
    );
    console.warn(`  Sample response: ${JSON.stringify(shortEvents[0]).slice(0, 300)}`);
    fbFailures[pageUrl] = { failed: true, error: "Response shape validation failed" };
    return [];
  }

  if (validShort.length < shortEvents.length) {
    console.warn(
      `  ${shortEvents.length - validShort.length} of ${shortEvents.length} ` +
      `Facebook events failed shape validation (skipped)`
    );
  }

  if (validShort.length === 0) {
    console.log(`  No upcoming Facebook events found`);
    fbFailures[pageUrl] = { failed: false };
    return [];
  }

  console.log(`  Found ${validShort.length} upcoming Facebook events, fetching details...`);

  const events: ExtractedEvent[] = [];
  let detailFailures = 0;

  for (const short of validShort) {
    try {
      const full = await scrapeFbEvent(short.url);

      if (!isValidFullEvent(full)) {
        console.warn(`    Event ${short.id} has invalid detail shape, skipping`);
        detailFailures++;
        continue;
      }

      if (full.isCanceled) {
        console.log(`    Skipping cancelled: ${full.name}`);
        continue;
      }
      events.push(toExtractedEvent(full, venue));
    } catch (err) {
      console.warn(`    Failed to fetch event ${short.id}:`, err);
      detailFailures++;
    }
  }

  // If most detail fetches failed, the scraper is likely broken
  if (detailFailures > 0 && detailFailures >= validShort.length * 0.5) {
    console.warn(
      `  WARNING: ${detailFailures}/${validShort.length} event detail fetches failed. ` +
      `The facebook-event-scraper package may need updating.`
    );
  }

  fbFailures[pageUrl] = { failed: false };
  console.log(`  Successfully extracted ${events.length} Facebook events`);
  return events;
}
