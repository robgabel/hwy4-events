"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Hwy4Event, Hwy4Org, EventCategory, CollapsedEvent } from "@/lib/types";
import EventCard from "./EventCard";
import FilterBar from "./FilterBar";
import { format, parseISO, isToday, isTomorrow, isThisWeek } from "date-fns";

function getBaseName(name: string): string {
  return name
    .replace(/\s*-\s*Day\s*\d+$/i, "")
    .replace(/\s*\(through[^)]*\)$/i, "")
    .replace(/\s*\(Opening Day\)$/i, "")
    .trim();
}

function collapseMultiDayEvents(events: Hwy4Event[]): CollapsedEvent[] {
  const baseNameMap = new Map<string, Hwy4Event[]>();

  for (const event of events) {
    const baseName = getBaseName(event.name);
    if (!baseNameMap.has(baseName)) {
      baseNameMap.set(baseName, []);
    }
    baseNameMap.get(baseName)!.push(event);
  }

  const collapsedIds = new Set<string>();
  const collapsedGroups = new Map<string, Hwy4Event[]>();

  for (const [baseName, groupEvents] of baseNameMap) {
    if (groupEvents.length > 1) {
      collapsedGroups.set(baseName, groupEvents);
      for (const e of groupEvents) {
        collapsedIds.add(e.id);
      }
    }
  }

  const result: CollapsedEvent[] = [];
  const addedBases = new Set<string>();

  for (const event of events) {
    if (collapsedIds.has(event.id)) {
      const baseName = getBaseName(event.name);
      if (!addedBases.has(baseName)) {
        addedBases.add(baseName);
        const groupEvents = collapsedGroups.get(baseName)!;
        const allArtists = [
          ...new Set(groupEvents.flatMap((e) => e.artists || [])),
        ];
        result.push({
          ...groupEvents[0],
          name: baseName,
          endDate: groupEvents[groupEvents.length - 1].date,
          dayCount: groupEvents.length,
          isCollapsed: true,
          artists: allArtists.length > 0 ? allArtists : groupEvents[0].artists,
        });
      }
    } else {
      result.push(event);
    }
  }

  return result;
}

function groupEventsByDate(events: CollapsedEvent[]) {
  const groups: { label: string; date: string; events: CollapsedEvent[] }[] =
    [];
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
  orgs,
}: {
  initialEvents: Hwy4Event[];
  orgs: Hwy4Org[];
}) {
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [town, setTown] = useState<string>("all");
  const [enabledOrgs, setEnabledOrgs] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterHeight, setFilterHeight] = useState(0);

  useEffect(() => {
    const el = filterRef.current;
    if (!el) return;
    const update = () => setFilterHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleOrg = useCallback((slug: string) => {
    setEnabledOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const visible = initialEvents.filter((e) => {
      if (e.visibility === "private") {
        if (!e.org_slug || !enabledOrgs.has(e.org_slug)) return false;
      }
      if (category !== "all" && e.category !== category) return false;
      if (town !== "all" && e.town !== town) return false;
      return true;
    });
    return collapseMultiDayEvents(visible);
  }, [initialEvents, category, town, enabledOrgs]);

  const groups = useMemo(() => groupEventsByDate(filtered), [filtered]);

  const upNextId =
    groups.length > 0 && groups[0].events.length > 0
      ? groups[0].events[0].id
      : null;

  return (
    <div>
      {/* Sticky filter bar */}
      <div
        ref={filterRef}
        className="sticky top-0 z-20 -mx-4 border-b border-stone-light/0 bg-cream/90 px-4 pb-4 pt-1 backdrop-blur-md [&:not(:first-child)]:border-stone-light/20"
      >
        <FilterBar
          selectedCategory={category}
          selectedTown={town}
          onCategoryChange={setCategory}
          onTownChange={setTown}
          eventCount={filtered.length}
          orgs={orgs}
          enabledOrgs={enabledOrgs}
          onToggleOrg={toggleOrg}
        />
      </div>

      {/* Event list */}
      <div className="mt-2 space-y-6">
        {groups.length === 0 ? (
          <div className="animate-fadeIn rounded-xl border border-stone-light/30 bg-white px-6 py-12 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/millie-happy.svg"
              alt="Millie the sheepadoodle"
              className="mx-auto h-20 w-20 opacity-40"
            />
            <p className="mt-3 text-stone">
              Nothing matching those filters. Millie&apos;s bored too.
            </p>
            <button
              onClick={() => {
                setCategory("all");
                setTown("all");
                setEnabledOrgs(new Set());
              }}
              className="mt-2 text-sm font-medium text-pine hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <section
              key={group.date}
              className="animate-fadeIn"
              style={{ animationDelay: `${groupIndex * 50}ms` }}
            >
              {/* Sticky date header */}
              <div
                className="sticky z-10 -mx-4 mb-3 bg-cream/95 px-4 py-2 backdrop-blur-sm"
                style={{ top: `${filterHeight}px` }}
              >
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-earth">
                  <span className="h-px flex-1 bg-stone-light/40" />
                  {group.label}
                  <span className="h-px flex-1 bg-stone-light/40" />
                </h2>
              </div>
              <div className="space-y-3">
                {group.events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    isUpNext={event.id === upNextId}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
