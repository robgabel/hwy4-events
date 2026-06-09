"use client";

import { Fragment } from "react";
import type { Hwy4Event, CollapsedEvent } from "@/lib/types";
import EventCard from "./EventCard";
import NewsletterSignup from "./NewsletterSignup";

/**
 * Minimal client-rendered list of EventCards, used by server pages (town,
 * category, venue) that need to render events without the homepage's filter
 * bar, newsletter signup, or day-section grouping. EventCard pulls in
 * dynamic imports with ssr:false, which is why this needs to be a client
 * boundary.
 *
 * Pass `newsletterAfterIndex` to drop the homepage's inline NewsletterSignup
 * after that 0-based event index (e.g. 4 = after the 5th event), matching the
 * homepage list. Only renders the signup when the list is long enough to reach
 * that index.
 */
export default function SimpleEventList({
  events,
  newsletterAfterIndex,
  newsletterSource,
}: {
  events: Hwy4Event[];
  newsletterAfterIndex?: number;
  /** Attribution code for the inline signup (R1b), e.g. "town_murphys". */
  newsletterSource?: string;
}) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-3">
      {events.map((e, i) => (
        <Fragment key={e.id}>
          <EventCard event={e as CollapsedEvent} />
          {i === newsletterAfterIndex && (
            <NewsletterSignup variant="inline" source={newsletterSource} />
          )}
        </Fragment>
      ))}
    </div>
  );
}
