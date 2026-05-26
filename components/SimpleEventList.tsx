"use client";

import type { Hwy4Event, CollapsedEvent } from "@/lib/types";
import EventCard from "./EventCard";

/**
 * Minimal client-rendered list of EventCards, used by server pages (town,
 * category, venue) that need to render events without the homepage's filter
 * bar, newsletter signup, or day-section grouping. EventCard pulls in
 * dynamic imports with ssr:false, which is why this needs to be a client
 * boundary.
 */
export default function SimpleEventList({
  events,
}: {
  events: Hwy4Event[];
}) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-3">
      {events.map((e) => (
        <EventCard key={e.id} event={e as CollapsedEvent} />
      ))}
    </div>
  );
}
