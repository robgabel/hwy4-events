"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Hwy4Event,
  Hwy4Org,
  EventCategory,
  CollapsedEvent,
  TOWNS,
} from "@/lib/types";
import Image from "next/image";
import dynamic from "next/dynamic";
import EventCard from "./EventCard";
import {
  parseDate,
  isToday,
  isTomorrow,
  isThisWeek,
  differenceInCalendarDays,
  startOfDay,
  getNextFriday,
  formatFullDate,
  formatLongWeekday,
  formatLongMonthDay,
  formatISODate,
} from "@/lib/date-utils";
import { nowPacificMinutes, hasEventEnded } from "@/lib/event-time";

// Lazy-load non-critical components so they don't block hydration
const FilterBar = dynamic(() => import("./FilterBar"), { ssr: true });
const NewsletterSignup = dynamic(() => import("./NewsletterSignup"), {
  ssr: false,
});

const ALL_CATEGORIES: EventCategory[] = [
  "civic",
  "festival",
  "games",
  "hike_walk",
  "kids",
  "live_music",
  "other",
  "wine",
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
      const dates = groupEvents.map((e) => parseDate(e.date));
      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));
      const span = differenceInCalendarDays(maxDate, minDate);

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
      const dateObj = parseDate(event.date);
      let label = formatFullDate(dateObj);
      if (isToday(dateObj)) label = `Today — ${formatLongMonthDay(dateObj)}`;
      else if (isTomorrow(dateObj))
        label = `Tomorrow — ${formatLongMonthDay(dateObj)}`;
      else if (isThisWeek(dateObj))
        label = `This ${formatLongWeekday(dateObj)} — ${formatLongMonthDay(dateObj)}`;

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
    fri = getNextFriday(today);
    sun = new Date(fri);
    sun.setDate(sun.getDate() + 2);
  }

  return {
    start: formatISODate(fri),
    end: formatISODate(sun),
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
  const [freeOnly, setFreeOnly] = useState(false);
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
        // Members-only (e.g. Blue Lake Springs): shown only when the org is
        // explicitly enabled in the Clubs filter. The Event Type filter does
        // not apply — "club" is not a selectable type.
        if (!e.org_slug || !enabledOrgs.has(e.org_slug)) return false;
      } else if (!selectedCategories.has(e.category)) {
        return false;
      }
      if (!selectedTowns.has(e.town)) return false;
      if (e.is_weekly && !showWeekly) return false;
      if (weekendOnly && weekendRange) {
        if (e.date < weekendRange.start || e.date > weekendRange.end) return false;
      }
      if (freeOnly && e.cost_tier !== "free") return false;
      return true;
    });
    return collapseMultiDayEvents(visible);
  }, [initialEvents, selectedCategories, selectedTowns, showWeekly, enabledOrgs, weekendOnly, weekendRange, freeOnly]);

  const groups = useMemo(() => groupEventsByDate(filtered), [filtered]);

  // "Up Next" must respect the clock: today's earliest event shouldn't keep the
  // badge after it's over (a 10:30 AM storytime is not "up next" at 4 PM). The
  // page is statically rendered, so there's no useful server clock — compute
  // Pacific "now" on the client and refresh each minute. `now` is null until
  // mounted, so the badge simply doesn't render server-side (no stale highlight,
  // no hydration mismatch); it appears on the right event after hydration.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(nowPacificMinutes());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // First event, in chronological order, that hasn't ended yet (skips finished
  // earlier-today events; a currently-live event still qualifies).
  const upNextId = useMemo(() => {
    if (now === null) return null;
    for (const group of groups) {
      for (const event of group.events) {
        if (!hasEventEnded(event.date, event.start_time, event.end_time, now)) {
          return event.id;
        }
      }
    }
    return null;
  }, [groups, now]);

  // Progressive rendering: only hydrate a small initial batch, then load more
  // as the user scrolls. This keeps hydration fast (<2s) even with 200+ events.
  const INITIAL_EVENTS = 15;
  const BATCH_SIZE = 20;
  // Auto-load on scroll for the first couple of batches, then hand control
  // back with an explicit "Show more" button. Pure infinite scroll never lets
  // the page end, so the footer (town directory, what's-on links, submit CTA)
  // becomes unreachable — the list keeps growing as you approach the bottom.
  // Capping the auto-load gives the page a real terminus and locks the footer in.
  const AUTO_LOAD_LIMIT = 55; // initial 15 + two auto-batches
  const totalEvents = filtered.length;
  const [visibleCount, setVisibleCount] = useState(INITIAL_EVENTS);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset visible count when filters change (show initial batch of new results)
  const filteredKey = `${selectedCategories.size}-${selectedTowns.size}-${showWeekly}-${enabledOrgs.size}-${weekendOnly}-${freeOnly}`;
  useEffect(() => {
    setVisibleCount(INITIAL_EVENTS);
  }, [filteredKey]);

  // IntersectionObserver to auto-load more events on scroll — but only up to
  // AUTO_LOAD_LIMIT, so the infinite scroll terminates and the footer stays
  // reachable. Past the limit, loading is driven by the "Show more" button.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= totalEvents || visibleCount >= AUTO_LOAD_LIMIT)
      return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, totalEvents));
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, totalEvents]);

  // Slice groups to only include the visible event count
  const visibleGroups = useMemo(() => {
    let count = 0;
    const result: typeof groups = [];
    for (const group of groups) {
      if (count >= visibleCount) break;
      const remaining = visibleCount - count;
      if (group.events.length <= remaining) {
        result.push(group);
        count += group.events.length;
      } else {
        result.push({ ...group, events: group.events.slice(0, remaining) });
        count += remaining;
      }
    }
    return result;
  }, [groups, visibleCount]);

  const MEMBER_ORG_SLUGS = new Set(["moose-lodge", "sequoia-woods", "blue-lake-springs"]);
  const memberOrgs = orgs.filter((o) => MEMBER_ORG_SLUGS.has(o.slug));

  return (
    <div>
      {/* Sticky filter bar */}
      <div
        ref={filterRef}
        className="sticky top-0 z-20 -mx-4 border-b border-stone-light/0 bg-cream/90 px-4 pb-4 pt-1 backdrop-blur-md [&:not(:first-child)]:border-stone-light/20"
      >
        {/* Quick filters: This Weekend / Free */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setWeekendOnly(!weekendOnly)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              weekendOnly
                ? "border-pine bg-pine text-white"
                : "border-stone-light/40 bg-white text-stone hover:border-pine hover:text-pine"
            }`}
          >
            This Weekend
          </button>
          <button
            onClick={() => setFreeOnly(!freeOnly)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              freeOnly
                ? "border-pine bg-pine text-white"
                : "border-stone-light/40 bg-white text-stone hover:border-pine hover:text-pine"
            }`}
          >
            Free
          </button>
          {(weekendOnly || freeOnly) && (
            <button
              onClick={() => {
                setWeekendOnly(false);
                setFreeOnly(false);
              }}
              className="cursor-pointer text-xs text-stone hover:text-pine"
            >
              Clear quick filters
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
            <Image
              src="/millie-happy.svg"
              alt="Millie the sheepadoodle"
              width={80}
              height={80}
              className="mx-auto opacity-40"
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
                setWeekendOnly(false);
                setFreeOnly(false);
              }}
              className="mt-2 cursor-pointer text-sm font-medium text-pine hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {visibleGroups.map((group, groupIndex) => (
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
            ))}
            {/* List terminus: auto-load a couple of batches for an effortless
             * browse, then require a click so the page ends and the footer
             * (towns, what's-on, submit) is always reachable. */}
            {visibleCount < totalEvents ? (
              visibleCount < AUTO_LOAD_LIMIT ? (
                <div
                  ref={sentinelRef}
                  className="py-4 text-center text-sm text-stone"
                >
                  Loading more events…
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8">
                  <button
                    onClick={() =>
                      setVisibleCount((prev) =>
                        Math.min(prev + BATCH_SIZE, totalEvents)
                      )
                    }
                    className="cursor-pointer rounded-lg bg-pine px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-forest"
                  >
                    Show {Math.min(BATCH_SIZE, totalEvents - visibleCount)} more
                    events
                  </button>
                  <span className="text-xs text-stone">
                    Showing {visibleCount} of {totalEvents}
                  </span>
                </div>
              )
            ) : (
              totalEvents > INITIAL_EVENTS && (
                <p className="py-8 text-center text-sm text-stone">
                  That&apos;s the whole calendar for now.
                </p>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
