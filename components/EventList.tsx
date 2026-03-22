"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Hwy4Event,
  Hwy4Org,
  EventCategory,
  CollapsedEvent,
  TOWNS,
} from "@/lib/types";
import EventCard from "./EventCard";
import FilterBar from "./FilterBar";
import NewsletterSignup from "./NewsletterSignup";
import { format, parseISO, isToday, isTomorrow, isThisWeek, differenceInCalendarDays, nextFriday, nextSunday, isFriday, isSaturday, isSunday, startOfDay } from "date-fns";

const ALL_CATEGORIES: EventCategory[] = [
  "civic",
  "festival",
  "live_music",
  "lodge",
  "other",
  "resort",
];

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
      // Only collapse if dates span a short, consecutive range (not weekly recurrences)
      const dates = groupEvents.map((e) => parseISO(e.date));
      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));
      const span = differenceInCalendarDays(maxDate, minDate);

      // Only collapse if the date span is <= 7 days (multi-day event, not weekly)
      if (span <= 7) {
        collapsedGroups.set(baseName, groupEvents);
        for (const e of groupEvents) {
          collapsedIds.add(e.id);
        }
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

function getThisWeekendRange(): { start: string; end: string } | null {
  const today = startOfDay(new Date());
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat

  let fri: Date;
  let sun: Date;

  if (dayOfWeek === 5) {
    // Friday
    fri = today;
    sun = new Date(today);
    sun.setDate(sun.getDate() + 2);
  } else if (dayOfWeek === 6) {
    // Saturday
    fri = new Date(today);
    fri.setDate(fri.getDate() - 1);
    sun = new Date(today);
    sun.setDate(sun.getDate() + 1);
  } else if (dayOfWeek === 0) {
    // Sunday
    fri = new Date(today);
    fri.setDate(fri.getDate() - 2);
    sun = today;
  } else {
    // Mon-Thu: next weekend
    fri = nextFriday(today);
    sun = new Date(fri);
    sun.setDate(sun.getDate() + 2);
  }

  return {
    start: format(fri, "yyyy-MM-dd"),
    end: format(sun, "yyyy-MM-dd"),
  };
}

export default function EventList({
  initialEvents,
  orgs,
}: {
  initialEvents: Hwy4Event[];
  orgs: Hwy4Org[];
}) {
  const [selectedCategories, setSelectedCategories] = useState<
    Set<EventCategory>
  >(new Set(ALL_CATEGORIES));
  const [selectedTowns, setSelectedTowns] = useState<Set<string>>(
    new Set(TOWNS)
  );
  const [showWeekly, setShowWeekly] = useState(true);
  const [enabledOrgs, setEnabledOrgs] = useState<Set<string>>(new Set());
  const [weekendOnly, setWeekendOnly] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterHeight, setFilterHeight] = useState(0);

  // URL-based town filtering: ?town=Avery or ?town=Avery&town=Arnold
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const townParams = params.getAll("town");
    if (townParams.length > 0) {
      const validTowns = townParams.filter((t) =>
        (TOWNS as readonly string[]).includes(t)
      );
      if (validTowns.length > 0) {
        setSelectedTowns(new Set(validTowns));
      }
    }
  }, []);

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

  const weekendRange = useMemo(() => getThisWeekendRange(), []);

  const filtered = useMemo(() => {
    const visible = initialEvents.filter((e) => {
      if (e.visibility === "private") {
        if (!e.org_slug || !enabledOrgs.has(e.org_slug)) return false;
      }
      if (!selectedCategories.has(e.category)) return false;
      if (!selectedTowns.has(e.town)) return false;
      if (e.is_weekly && !showWeekly) return false;
      if (weekendOnly && weekendRange) {
        if (e.date < weekendRange.start || e.date > weekendRange.end) return false;
      }
      return true;
    });
    return collapseMultiDayEvents(visible);
  }, [initialEvents, selectedCategories, selectedTowns, showWeekly, enabledOrgs, weekendOnly, weekendRange]);

  const groups = useMemo(() => groupEventsByDate(filtered), [filtered]);

  const upNextId =
    groups.length > 0 && groups[0].events.length > 0
      ? groups[0].events[0].id
      : null;

  const MEMBER_ORG_SLUGS = new Set(["moose-lodge", "sequoia-woods"]);
  const memberOrgs = orgs.filter((o) => MEMBER_ORG_SLUGS.has(o.slug));

  return (
    <div>
      {/* Sticky filter bar */}
      <div
        ref={filterRef}
        className="sticky top-0 z-20 -mx-4 border-b border-stone-light/0 bg-cream/90 px-4 pb-4 pt-1 backdrop-blur-md [&:not(:first-child)]:border-stone-light/20"
      >
        {/* Quick filter: This Weekend */}
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => setWeekendOnly(!weekendOnly)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              weekendOnly
                ? "border-pine bg-pine text-white"
                : "border-stone-light/40 bg-white text-stone hover:border-pine hover:text-pine"
            }`}
          >
            This Weekend
          </button>
          {weekendOnly && (
            <button
              onClick={() => setWeekendOnly(false)}
              className="text-xs text-stone hover:text-pine"
            >
              Show all dates
            </button>
          )}
        </div>
        <FilterBar
          selectedCategories={selectedCategories}
          onCategoriesChange={setSelectedCategories}
          selectedTowns={selectedTowns}
          onTownsChange={setSelectedTowns}
          showWeekly={showWeekly}
          onShowWeeklyChange={setShowWeekly}
          eventCount={filtered.length}
          orgs={memberOrgs}
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
                setSelectedCategories(new Set(ALL_CATEGORIES));
                setSelectedTowns(new Set(TOWNS));
                setShowWeekly(true);
                setEnabledOrgs(new Set());
              }}
              className="mt-2 text-sm font-medium text-pine hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.date}>
              {/* Inline newsletter signup between day 2 and day 3 */}
              {groupIndex === 2 && <NewsletterSignup variant="inline" />}
              <section
                className="animate-fadeIn"
                style={{ animationDelay: `${groupIndex * 50}ms` }}
              >
                {/* Sticky date header */}
                <div
                  className="sticky z-10 -mx-4 mb-3 bg-cream/95 px-4 py-2 backdrop-blur-sm"
                  style={{ top: `${filterHeight}px` }}
                >
                  <h2 className="font-display flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-earth">
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
