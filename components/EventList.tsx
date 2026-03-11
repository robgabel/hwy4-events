"use client";

import { useState, useMemo } from "react";
import { Hwy4Event, EventCategory } from "@/lib/types";
import EventCard from "./EventCard";
import FilterBar from "./FilterBar";
import { format, parseISO, isToday, isTomorrow, isThisWeek } from "date-fns";

function groupEventsByDate(events: Hwy4Event[]) {
  const groups: { label: string; date: string; events: Hwy4Event[] }[] = [];
  let currentDate = "";

  for (const event of events) {
    if (event.date !== currentDate) {
      currentDate = event.date;
      const dateObj = parseISO(event.date);
      let label = format(dateObj, "EEEE, MMMM d, yyyy");
      if (isToday(dateObj)) label = `Today — ${format(dateObj, "MMMM d")}`;
      else if (isTomorrow(dateObj))
        label = `Tomorrow — ${format(dateObj, "MMMM d")}`;
      else if (isThisWeek(dateObj))
        label = `This ${format(dateObj, "EEEE")} — ${format(dateObj, "MMMM d")}`;

      groups.push({ label, date: event.date, events: [] });
    }
    groups[groups.length - 1].events.push(event);
  }

  return groups;
}

export default function EventList({
  initialEvents,
}: {
  initialEvents: Hwy4Event[];
}) {
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [town, setTown] = useState<string>("all");

  const filtered = useMemo(() => {
    return initialEvents.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (town !== "all" && e.town !== town) return false;
      return true;
    });
  }, [initialEvents, category, town]);

  const groups = useMemo(() => groupEventsByDate(filtered), [filtered]);

  return (
    <div className="space-y-6">
      <FilterBar
        selectedCategory={category}
        selectedTown={town}
        onCategoryChange={setCategory}
        onTownChange={setTown}
        eventCount={filtered.length}
      />

      {groups.length === 0 ? (
        <div className="rounded-xl border border-stone-light/30 bg-white px-6 py-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-stone-light"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
            />
          </svg>
          <p className="mt-3 text-stone">
            No events found with those filters.
          </p>
          <button
            onClick={() => {
              setCategory("all");
              setTown("all");
            }}
            className="mt-2 text-sm font-medium text-pine hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.date}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-earth">
              <span className="h-px flex-1 bg-stone-light/40" />
              {group.label}
              <span className="h-px flex-1 bg-stone-light/40" />
            </h2>
            <div className="space-y-3">
              {group.events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
