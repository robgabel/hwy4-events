"use server";

import { getEventsBeyondHorizon, toListEvents } from "@/lib/events-data";
import type { EventListItem } from "@/lib/types";

/**
 * Homepage "load more" past the 60-day horizon. Returns the lightweight list
 * projection (trimmed description, no scrape-only columns) of every upcoming
 * event beyond the homepage window, deduped/sorted upstream and served from the
 * shared cached superset — no new database scan. Called by the client EventList
 * when a visitor pages past the near-term feed or filters into a near-term gap.
 */
export async function fetchEventsBeyondHorizon(): Promise<EventListItem[]> {
  const events = await getEventsBeyondHorizon();
  return toListEvents(events);
}
