"use client";

import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from "react";
import {
  EventListItem,
  Hwy4Org,
  EventCategory,
  CollapsedEvent,
  TOWNS,
} from "@/lib/types";
import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import EventCard from "./EventCard";
import type { TownForecasts } from "@/lib/weather";
import {
  parseDate,
  startOfDay,
  getNextFriday,
  formatFullDate,
  formatLongWeekday,
  formatLongMonthDay,
  formatISODate,
} from "@/lib/date-utils";
import { collapseEventList, isHighlightEvent } from "@/lib/collapse-events";
import { pacificToday, pacificDateGroupKind } from "@/lib/date-windows";
import { nowPacificMinutes, hasEventEnded, hasEventStarted } from "@/lib/event-time";

// Lazy-load non-critical components so they don't block hydration
const FilterBar = dynamic(() => import("./FilterBar"), { ssr: true });
const NewsletterSignup = dynamic(() => import("./NewsletterSignup"), {
  ssr: false,
});

const ALL_CATEGORIES: EventCategory[] = [
  "civic",
  "festival",
  "fine_arts",
  "games",
  "hike_walk",
  "kids",
  "live_music",
  "other",
  "wine",
];

// Insert the inline newsletter signup right after the 5th event in the list
// (0-based index 4), regardless of which day that event falls on.
const NEWSLETTER_AFTER_EVENT_INDEX = 4;

// A multi-day collapsed event is represented by its FIRST day, but it's only
// "over" once the final day's slot has passed — so check ended against endDate.
// (hasEventEnded folds the date into its comparison, so a future endDate is
// never treated as ended even if the morning start_time has gone by today.)
function eventHasEnded(event: CollapsedEvent, nowMinutes: number): boolean {
  const lastDay =
    event.isCollapsed && event.endDate ? event.endDate : event.date;
  return hasEventEnded(lastDay, event.start_time, event.end_time, nowMinutes);
}

function groupEventsByDate(events: CollapsedEvent[]) {
  const groups: { label: string; date: string; events: CollapsedEvent[] }[] =
    [];
  let currentDate = "";

  // Anchor the Today/Tomorrow/This-<day> labels to the corridor's Pacific civil
  // date, computed identically on the server (UTC runtime) and the client via
  // Intl — so SSR and hydration agree and an evening event is never mislabeled.
  const { iso: todayIso, dow } = pacificToday();

  for (const event of events) {
    if (event.date !== currentDate) {
      currentDate = event.date;
      const dateObj = parseDate(event.date);
      let label = formatFullDate(dateObj);
      const kind = pacificDateGroupKind(event.date, todayIso, dow);
      if (kind === "today") label = `Today — ${formatLongMonthDay(dateObj)}`;
      else if (kind === "tomorrow")
        label = `Tomorrow — ${formatLongMonthDay(dateObj)}`;
      else if (kind === "this-week")
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

type SavedListState = { count: number; scrollY: number };

// The homepage list length + scroll offset, stashed in sessionStorage so a
// round-trip to an event page (which re-mounts this client component) can land
// the user back where they were instead of the default first-25 view.
const LIST_STATE_KEY = "hwy4:home-list-state";

function readSavedListState(): SavedListState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LIST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedListState>;
    if (typeof parsed.count === "number" && typeof parsed.scrollY === "number") {
      return { count: parsed.count, scrollY: parsed.scrollY };
    }
  } catch {
    // unavailable or malformed storage — fall back to defaults
  }
  return null;
}

function writeSavedListState(state: SavedListState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LIST_STATE_KEY, JSON.stringify(state));
  } catch {
    // storage full / unavailable — best-effort, ignore
  }
}

// "highlights" trims the feed to distinct happenings (one-offs, festivals,
// picks, live music with a named act) by dropping the recurring weekly
// regulars; "everything" keeps them (collapsed to one card per series).
type ViewMode = "highlights" | "everything";

type SavedFilterPrefs = {
  categories: EventCategory[];
  towns: string[];
  showWeekly: boolean;
  orgs: string[];
  viewMode: ViewMode;
};

// The homepage filter selections (event types, towns, weekly, clubs), saved to
// localStorage so they survive across visits — a Blue Lake Springs resident's
// club stays on, a retiree who unchecks Kids/Weekly keeps them off, no re-doing
// it every visit. The quick chips (This Weekend / Free / Kids / Live Music) are
// deliberately NOT persisted: those are momentary browsing, not a standing
// preference. Read after mount only, so the server render uses defaults and
// there's no hydration mismatch (same pattern as the `now` clock).
const FILTER_PREFS_KEY = "hwy4:filter-prefs";

function readFilterPrefs(): SavedFilterPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FILTER_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedFilterPrefs>;
    return {
      // Validate against the current known lists so a removed category/town in
      // an old saved blob can't wedge the filter into an empty state.
      categories: Array.isArray(parsed.categories)
        ? parsed.categories.filter((c): c is EventCategory =>
            (ALL_CATEGORIES as string[]).includes(c)
          )
        : [...ALL_CATEGORIES],
      towns: Array.isArray(parsed.towns)
        ? parsed.towns.filter((t) => (TOWNS as readonly string[]).includes(t))
        : [...TOWNS],
      showWeekly:
        typeof parsed.showWeekly === "boolean" ? parsed.showWeekly : true,
      orgs: Array.isArray(parsed.orgs)
        ? parsed.orgs.filter((o): o is string => typeof o === "string")
        : [],
      viewMode: parsed.viewMode === "highlights" ? "highlights" : "everything",
    };
  } catch {
    return null;
  }
}

function writeFilterPrefs(prefs: SavedFilterPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage full / unavailable — best-effort, ignore
  }
}

export default function EventList({
  initialEvents,
  orgs,
  forecastsByTown = null,
}: {
  initialEvents: EventListItem[];
  orgs: Hwy4Org[];
  forecastsByTown?: TownForecasts | null;
}) {
  const [selectedCategories, setSelectedCategories] = useState<
    Set<EventCategory>
  >(new Set(ALL_CATEGORIES));
  const [selectedTowns, setSelectedTowns] = useState<Set<string>>(
    new Set(TOWNS)
  );
  const [showWeekly, setShowWeekly] = useState(true);
  const [enabledOrgs, setEnabledOrgs] = useState<Set<string>>(new Set());
  // Highlights | Everything view toggle. A standing preference (persisted with
  // the filters, unlike the momentary quick chips); defaults to Everything so
  // nothing is hidden until the reader chooses.
  const [viewMode, setViewMode] = useState<ViewMode>("everything");
  const [weekendOnly, setWeekendOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  // Category quick filter (Kids / Live Music). Mutually exclusive — an event
  // can't be both, so picking one clears the other.
  const [categoryQuick, setCategoryQuick] = useState<EventCategory | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterHeight, setFilterHeight] = useState(0);
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  // True when the current towns selection came from a ?town= deep link the user
  // hasn't touched yet. While true we don't persist towns (a town-page click
  // shouldn't permanently pin someone to that town); cleared on any manual town
  // edit or reset.
  const urlTownScopedRef = useRef(false);

  // Hydrate persistent filters on mount. A ?town= deep link (from a town/about
  // page) wins for the towns dimension and is treated as a transient scoped
  // view; otherwise restore the saved towns. Event types, weekly, and clubs
  // always restore from saved prefs. Runs after mount (no hydration mismatch).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const townParams = params
      .getAll("town")
      .filter((t) => (TOWNS as readonly string[]).includes(t));
    const prefs = readFilterPrefs();

    if (townParams.length > 0) {
      setSelectedTowns(new Set(townParams));
      urlTownScopedRef.current = true;
    } else if (prefs) {
      setSelectedTowns(new Set(prefs.towns));
    }
    if (prefs) {
      setSelectedCategories(new Set(prefs.categories));
      setShowWeekly(prefs.showWeekly);
      setEnabledOrgs(new Set(prefs.orgs));
      setViewMode(prefs.viewMode);
    }
    setPrefsHydrated(true);
  }, []);

  // Persist filters whenever they change — but only after hydration, so the
  // initial default state can't clobber saved prefs before they're read. While
  // a ?town= scoped view is untouched, preserve the previously-saved towns
  // instead of writing the scoped subset.
  useEffect(() => {
    if (!prefsHydrated) return;
    const saved = urlTownScopedRef.current ? readFilterPrefs() : null;
    const towns =
      urlTownScopedRef.current
        ? saved?.towns ?? [...TOWNS]
        : [...selectedTowns];
    writeFilterPrefs({
      categories: [...selectedCategories],
      towns,
      showWeekly,
      orgs: [...enabledOrgs],
      viewMode,
    });
  }, [prefsHydrated, selectedCategories, selectedTowns, showWeekly, enabledOrgs, viewMode]);

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

  // A manual town edit means the user owns the towns selection now — stop
  // treating it as a transient ?town= scoped view, so it persists going forward.
  const handleTownsChange = useCallback((towns: Set<string>) => {
    urlTownScopedRef.current = false;
    setSelectedTowns(towns);
  }, []);

  const resetFilters = useCallback(() => {
    urlTownScopedRef.current = false;
    setSelectedCategories(new Set(ALL_CATEGORIES));
    setSelectedTowns(new Set(TOWNS));
    setShowWeekly(true);
    setEnabledOrgs(new Set());
    setViewMode("everything");
    setWeekendOnly(false);
    setFreeOnly(false);
    setCategoryQuick(null);
  }, []);

  // Whether the persistent filters (not the momentary quick chips) sit at their
  // defaults — drives the "your filters are saved · show all" escape hatch.
  // viewMode is deliberately excluded: the hatch guards against filters hidden
  // in the collapsed panel, and the Highlights/Everything toggle is always
  // visible with its own state (though resetFilters still clears it).
  const filtersAreDefault =
    selectedCategories.size === ALL_CATEGORIES.length &&
    selectedTowns.size === TOWNS.length &&
    showWeekly &&
    enabledOrgs.size === 0;

  const weekendRange = useMemo(() => getThisWeekendRange(), []);

  // Today's list shouldn't keep showing events that are already over (a 9:30 AM
  // bird walk is not "today's plan" at 4 PM). The page is statically rendered,
  // so there's no useful server clock — compute Pacific "now" on the client and
  // refresh each minute. `now` is null until mounted, so the server render (and
  // first client paint) shows everything for the current calendar day with no
  // hydration mismatch; finished events drop out a beat later, once hydrated.
  // The same clock drives the "Up Next" badge below.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(nowPacificMinutes());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    return initialEvents.filter((e) => {
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
      if (categoryQuick && e.category !== categoryQuick) return false;
      return true;
    });
  }, [initialEvents, selectedCategories, selectedTowns, showWeekly, enabledOrgs, weekendOnly, weekendRange, freeOnly, categoryQuick]);

  // Collapse repetition into one card per happening: multi-day runs become a
  // date-range card, weekly series become their next occurrence + a cadence
  // chip (lib/collapse-events.ts). Clock-aware so a series card re-anchors to
  // the next date once today's instance ends. The Highlights lens then drops
  // the recurring regulars (picks, festivals, and named-act live music stay).
  const collapsed = useMemo(() => {
    const cards = collapseEventList(filtered, now);
    return viewMode === "highlights" ? cards.filter(isHighlightEvent) : cards;
  }, [filtered, now, viewMode]);

  // Drop events that have already ended (today's morning slots, mostly). Until
  // the clock is known (`now === null`, i.e. server + first paint) show the full
  // day so there's no hydration mismatch; after mount, finished events fall off.
  const visible = useMemo(() => {
    if (now === null) return collapsed;
    return collapsed.filter((e) => !eventHasEnded(e, now));
  }, [collapsed, now]);

  const groups = useMemo(() => groupEventsByDate(visible), [visible]);

  // First event, in chronological order, that hasn't started yet (skips both
  // finished earlier-today events and currently-live ones). A live event already
  // shows "Happening Now", and the two badges are mutually exclusive: "Up Next"
  // is reserved for the soonest event that hasn't begun.
  const upNextId = useMemo(() => {
    if (now === null) return null;
    for (const group of groups) {
      for (const event of group.events) {
        const ended = hasEventEnded(event.date, event.start_time, event.end_time, now);
        const started = hasEventStarted(event.date, event.start_time, now);
        if (!ended && !started) {
          return event.id;
        }
      }
    }
    return null;
  }, [groups, now]);

  // Progressive rendering: only hydrate a small initial batch, then load the
  // rest in button-driven pages. This keeps hydration fast (<2s) even with
  // 200+ events, and the explicit button gives the page a real terminus so the
  // footer (town directory, what's-on links, submit CTA) is always reachable.
  const INITIAL_EVENTS = 25;
  const BATCH_SIZE = 50;
  const totalEvents = visible.length;
  const [visibleCount, setVisibleCount] = useState(INITIAL_EVENTS);

  // Captured once on mount (a lazy initializer runs before any effect, so the
  // persistence effect below can't clobber it). null on the server and on a
  // first-ever visit.
  const [savedListState] = useState<SavedListState | null>(readSavedListState);
  const pendingScrollRef = useRef<number | null>(null);

  // Reset visible count when filters change (show initial batch of new results)
  const filteredKey = `${selectedCategories.size}-${selectedTowns.size}-${showWeekly}-${enabledOrgs.size}-${weekendOnly}-${freeOnly}-${categoryQuick ?? ""}-${viewMode}`;
  useEffect(() => {
    setVisibleCount(INITIAL_EVENTS);
  }, [filteredKey]);

  // Restore the saved list length + scroll position when the user returns from
  // an event page. Declared AFTER the filter-reset effect so it wins the initial
  // mount — both run once, and the last write to visibleCount sticks. The scroll
  // itself is replayed by the effect below, once the list has grown tall enough.
  useEffect(() => {
    if (!savedListState) return;
    if (savedListState.count > INITIAL_EVENTS) {
      setVisibleCount(Math.min(savedListState.count, totalEvents));
    }
    if (savedListState.scrollY > 0) {
      pendingScrollRef.current = savedListState.scrollY;
    }
    // Replay once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Running event count at the START of each visible group, so a flat "Nth event
  // in the list" index can be recovered even though events are nested inside
  // per-day sections. Drives the inline newsletter signup's fixed position.
  const groupEventOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const group of visibleGroups) {
      offsets.push(acc);
      acc += group.events.length;
    }
    return offsets;
  }, [visibleGroups]);

  // Replay the saved scroll offset once the list has grown back to its restored
  // length. We retry on a short timer until the page is tall enough to reach the
  // offset, since content can keep extending the page after the first paint.
  // setTimeout (not rAF) so restoration still runs if the tab isn't foregrounded
  // at the moment of return — rAF is paused while a page is hidden.
  useEffect(() => {
    const target = pendingScrollRef.current;
    if (target === null) return;
    let timer = 0;
    let tries = 0;
    const step = () => {
      const reachable =
        document.documentElement.scrollHeight - window.innerHeight;
      if (reachable >= target || tries++ > 40) {
        window.scrollTo(0, target);
        pendingScrollRef.current = null;
        return;
      }
      timer = window.setTimeout(step, 50);
    };
    step();
    return () => clearTimeout(timer);
  }, [visibleGroups]);

  // Persist the list position (length + scroll) as the user paginates or
  // scrolls, so the restore above has something to replay. rAF-throttled; the
  // immediate save() also captures "Show more" count bumps even without a scroll.
  useEffect(() => {
    const save = () =>
      writeSavedListState({ count: visibleCount, scrollY: window.scrollY });
    save();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        save();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [visibleCount]);

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
          {/* Highlights | Everything view toggle. Two honest stops, not a
              slider: Highlights hides the recurring weekly regulars, Everything
              shows them (one card per series). Persisted with the filters. */}
          <div
            role="group"
            aria-label="Feed view"
            className="inline-flex overflow-hidden rounded-full border border-stone-light/40 bg-white text-xs font-medium"
          >
            <button
              onClick={() => setViewMode("highlights")}
              aria-pressed={viewMode === "highlights"}
              title="Just the standout stuff: one-offs, festivals, and shows with a named act"
              className={`cursor-pointer px-3 py-1 transition-colors ${
                viewMode === "highlights"
                  ? "bg-pine text-white"
                  : "text-stone hover:text-pine"
              }`}
            >
              Highlights
            </button>
            <button
              onClick={() => setViewMode("everything")}
              aria-pressed={viewMode === "everything"}
              title="The full calendar, weekly classes and regulars included"
              className={`cursor-pointer border-l border-stone-light/40 px-3 py-1 transition-colors ${
                viewMode === "everything"
                  ? "bg-pine text-white"
                  : "text-stone hover:text-pine"
              }`}
            >
              Everything
            </button>
          </div>
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
          <button
            onClick={() =>
              setCategoryQuick((prev) => (prev === "kids" ? null : "kids"))
            }
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              categoryQuick === "kids"
                ? "border-pine bg-pine text-white"
                : "border-stone-light/40 bg-white text-stone hover:border-pine hover:text-pine"
            }`}
          >
            Kids
          </button>
          <button
            onClick={() =>
              setCategoryQuick((prev) =>
                prev === "live_music" ? null : "live_music"
              )
            }
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              categoryQuick === "live_music"
                ? "border-pine bg-pine text-white"
                : "border-stone-light/40 bg-white text-stone hover:border-pine hover:text-pine"
            }`}
          >
            Live Music
          </button>
          {(weekendOnly || freeOnly || categoryQuick) && (
            <button
              onClick={() => {
                setWeekendOnly(false);
                setFreeOnly(false);
                setCategoryQuick(null);
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
          onTownsChange={handleTownsChange}
          showWeekly={showWeekly}
          onShowWeeklyChange={setShowWeekly}
          eventCount={visible.length}
          orgs={memberOrgs}
          enabledOrgs={enabledOrgs}
          onToggleOrg={toggleOrg}
        />
        {/* Escape hatch — appears only when the persistent filters are narrowed,
         * so a remembered (or deep-linked) view never silently eats content. */}
        {!filtersAreDefault && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-stone">
            <span>
              {urlTownScopedRef.current
                ? "Showing one town."
                : "Your filters are saved on this device."}
            </span>
            <button
              onClick={resetFilters}
              className="cursor-pointer font-medium text-pine hover:underline"
            >
              Show all events
            </button>
          </div>
        )}
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
              onClick={resetFilters}
              className="mt-2 cursor-pointer text-sm font-medium text-pine hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {visibleGroups.map((group, groupIndex) => (
              <div key={group.date}>
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
                    {group.events.map((event, eventIndex) => {
                      // Flat position of this card across the whole list, so the
                      // newsletter signup lands after the Nth event regardless of
                      // how events split across days.
                      const globalIndex =
                        groupEventOffsets[groupIndex] + eventIndex;
                      return (
                        <Fragment key={event.id}>
                          <EventCard
                            event={event}
                            isUpNext={event.id === upNextId}
                            forecastsByTown={forecastsByTown}
                          />
                          {/* Inline newsletter signup after the 5th event */}
                          {globalIndex === NEWSLETTER_AFTER_EVENT_INDEX && (
                            <NewsletterSignup variant="inline" source="homepage_event5" />
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                </section>
              </div>
            ))}
            {/* List terminus: load each next page on an explicit click so the
             * page ends and the footer (towns, what's-on, submit) is always
             * reachable. */}
            {visibleCount < totalEvents ? (
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
            ) : (
              totalEvents > INITIAL_EVENTS && (
                <p className="py-8 text-center text-sm text-stone">
                  That&apos;s what&apos;s coming up on the 4. Looking further
                  out?{" "}
                  <Link
                    href="/this-month"
                    className="font-medium text-pine hover:underline"
                  >
                    Browse this month
                  </Link>{" "}
                  or pick a town from the footer.
                </p>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
