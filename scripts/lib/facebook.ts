import {
  scrapeFbEventListFromPage,
  scrapeFbEvent,
  EventType,
  type ShortEventData,
  type EventData,
} from "facebook-event-scraper";
import type { ExtractedEvent } from "./extract.js";
import type { VenueContext } from "./extract.js";

/**
 * Map a Facebook event category label to our category enum.
 */
function mapCategory(fbCategories: EventData["categories"]): string {
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
  console.log(`  Fetching Facebook events from: ${pageUrl}`);

  let shortEvents: ShortEventData[];
  try {
    shortEvents = await scrapeFbEventListFromPage(
      pageUrl,
      EventType.Upcoming
    );
  } catch (err) {
    console.warn(`  Facebook event list scrape failed:`, err);
    return [];
  }

  if (shortEvents.length === 0) {
    console.log(`  No upcoming Facebook events found`);
    return [];
  }

  console.log(`  Found ${shortEvents.length} upcoming Facebook events, fetching details...`);

  const events: ExtractedEvent[] = [];

  for (const short of shortEvents) {
    try {
      const full = await scrapeFbEvent(short.url);
      if (full.isCanceled) {
        console.log(`    Skipping cancelled: ${full.name}`);
        continue;
      }
      events.push(toExtractedEvent(full, venue));
    } catch (err) {
      console.warn(`    Failed to fetch event ${short.id}:`, err);
      // Continue with other events
    }
  }

  console.log(`  Successfully extracted ${events.length} Facebook events`);
  return events;
}
