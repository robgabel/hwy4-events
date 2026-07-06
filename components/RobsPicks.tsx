import Link from "next/link";
import { Hwy4Event } from "@/lib/types";
import { generateEventSlug } from "@/lib/slugs";
import { selectPicks, PickEntry } from "@/lib/picks";
import { FESTIVAL_GUIDES, FestivalGuide, festivalGuideForEvent } from "@/lib/event-guides";
import {
  parseDate,
  formatShortWeekday,
  formatLongWeekday,
  formatDayOfMonth,
  formatShortMonth,
} from "@/lib/date-utils";

/**
 * The homepage curation layer: one "if you only make one plan" spotlight
 * (soonest still-running public robs_pick inside the next week) plus a compact
 * row of up to four more picks. A live festival guide (lib/event-guides.ts) is
 * a first-class entry here: it renders as a date-range card for the festival's
 * whole run and links to the guide page (selection rules in lib/picks.ts).
 * Server-rendered, typographic on purpose — no posters, no client JS. The full
 * filterable calendar stays below; this is the ritual layer that gives a
 * returning local something to check on Monday.
 */

type Entry = PickEntry<Hwy4Event>;

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

// An event pick's destination: its festival guide page when it has one,
// otherwise its own event detail page. Guide-matched picks are normally
// absorbed into the guide entry upstream (lib/picks.ts), so this is a safety
// net; every other pick keeps its /events/<slug> link.
function pickHref(event: Hwy4Event, todayIso: string): string {
  const guide = festivalGuideForEvent(event, todayIso);
  return guide ? guide.path : `/events/${generateEventSlug(event.name, event.date, event.town)}`;
}

function PawBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
        <ellipse cx="12" cy="15.5" rx="5" ry="4.5" />
        <ellipse cx="6.5" cy="9" rx="2.2" ry="2.8" transform="rotate(-15 6.5 9)" />
        <ellipse cx="10" cy="6.5" rx="2" ry="2.8" transform="rotate(-5 10 6.5)" />
        <ellipse cx="14" cy="6.5" rx="2" ry="2.8" transform="rotate(5 14 6.5)" />
        <ellipse cx="17.5" cy="9" rx="2.2" ry="2.8" transform="rotate(15 17.5 9)" />
      </svg>
      {label}
    </span>
  );
}

// The guide's display strings, shared by the spotlight and the small card.
// Upcoming: anchored on opening day, "through <close>" in the meta. In
// progress: the date block reads "Now" against the closing day, because the
// useful fact mid-run is when it ends, not when it started.
function guideDates(guide: FestivalGuide, inProgress: boolean) {
  const start = parseDate(guide.startDate);
  const end = parseDate(guide.hideAfter);
  const endLabel = `${formatShortMonth(end)} ${formatDayOfMonth(end)}`;
  return {
    block: inProgress
      ? { top: "Now", day: formatDayOfMonth(end), month: formatShortMonth(end) }
      : {
          top: formatShortWeekday(start),
          day: formatDayOfMonth(start),
          month: formatShortMonth(start),
        },
    meta: inProgress
      ? `Happening now, through ${endLabel}`
      : `${formatLongWeekday(start)}, ${formatShortMonth(start)} ${formatDayOfMonth(start)} through ${endLabel}`,
    range: inProgress
      ? `Now – ${endLabel}`
      : `${formatShortMonth(start)} ${formatDayOfMonth(start)} – ${endLabel}`,
  };
}

function Spotlight({ entry, todayIso }: { entry: Entry; todayIso: string }) {
  let href: string;
  let block: { top: string; day: string; month: string };
  let title: string;
  let meta: string;

  if (entry.kind === "guide") {
    const { guide, inProgress } = entry;
    const dates = guideDates(guide, inProgress);
    href = guide.path;
    block = dates.block;
    title = guide.title;
    meta = [dates.meta, guide.town, guide.label].join(" · ");
  } else {
    const event = entry.event;
    href = pickHref(event, todayIso);
    const d = parseDate(event.date);
    const time = formatTime(event.start_time);
    // Same junk-venue heuristic the about page uses: a comma means an
    // address-as-venue row ("Highway 4, Arnold, CA 95223"), not a place name.
    const venue =
      event.venue_name &&
      event.venue_name !== "Unknown Venue" &&
      !event.venue_name.includes(",")
        ? event.venue_name
        : null;
    block = {
      top: formatShortWeekday(d),
      day: formatDayOfMonth(d),
      month: formatShortMonth(d),
    };
    title = event.name;
    meta = [
      `${formatLongWeekday(d)}, ${formatShortMonth(d)} ${formatDayOfMonth(d)}`,
      time,
      venue,
      event.town,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <Link
      href={href}
      className="card-warm group flex gap-4 rounded-xl border border-earth/20 bg-white p-4 ring-1 ring-earth/10 transition-all duration-200 hover:-translate-y-0.5 hover:border-earth/40 sm:p-5"
    >
      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-earth/8 py-2.5">
        <span className="text-xs font-medium uppercase text-pine">{block.top}</span>
        <span className="font-display text-lg font-bold text-forest">{block.day}</span>
        <span className="text-xs text-stone">{block.month}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <PawBadge label="Rob's Pick" />
        </div>
        <h3 className="font-display mt-1 text-lg font-bold text-forest transition-colors group-hover:text-pine sm:text-xl">
          {title}
        </h3>
        <p className="mt-1 text-sm text-stone">{meta}</p>
      </div>
    </Link>
  );
}

function PickCard({ entry, todayIso }: { entry: Entry; todayIso: string }) {
  let href: string;
  let dateLine: string;
  let title: string;
  let town: string;

  if (entry.kind === "guide") {
    const dates = guideDates(entry.guide, entry.inProgress);
    href = entry.guide.path;
    dateLine = dates.range;
    title = entry.guide.title;
    town = entry.guide.town;
  } else {
    const event = entry.event;
    const d = parseDate(event.date);
    href = pickHref(event, todayIso);
    dateLine = `${formatShortWeekday(d)} · ${formatShortMonth(d)} ${formatDayOfMonth(d)}`;
    title = event.name;
    town = event.town;
  }

  return (
    <Link
      href={href}
      className="card-warm group rounded-lg border border-stone-light/30 bg-white p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-sage/40"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-pine">
        {dateLine}
      </p>
      <h4 className="mt-1 line-clamp-2 text-sm font-semibold text-forest transition-colors group-hover:text-pine">
        {title}
      </h4>
      <p className="mt-1 text-xs text-stone">{town}</p>
    </Link>
  );
}

function entryKey(entry: Entry): string {
  return entry.kind === "guide" ? entry.guide.path : entry.event.id;
}

export default function RobsPicks({
  events,
  todayIso,
  nowMinutes,
}: {
  events: Hwy4Event[];
  todayIso: string;
  nowMinutes: number;
}) {
  const { spotlight, picks } = selectPicks(
    events,
    todayIso,
    nowMinutes,
    FESTIVAL_GUIDES
  );
  if (!spotlight && picks.length === 0) return null;

  return (
    <section aria-label="Rob's Picks" className="mb-8">
      {spotlight && (
        <>
          <h2 className="font-display mb-2 text-sm font-semibold uppercase tracking-wider text-earth">
            If you do one thing this week
          </h2>
          <Spotlight entry={spotlight} todayIso={todayIso} />
        </>
      )}
      {picks.length > 0 && (
        <>
          <h2 className="font-display mb-2 mt-5 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-earth">
            <svg className="h-3.5 w-3.5 text-amber-700" viewBox="0 0 24 24" fill="currentColor">
              <ellipse cx="12" cy="15.5" rx="5" ry="4.5" />
              <ellipse cx="6.5" cy="9" rx="2.2" ry="2.8" transform="rotate(-15 6.5 9)" />
              <ellipse cx="10" cy="6.5" rx="2" ry="2.8" transform="rotate(-5 10 6.5)" />
              <ellipse cx="14" cy="6.5" rx="2" ry="2.8" transform="rotate(5 14 6.5)" />
              <ellipse cx="17.5" cy="9" rx="2.2" ry="2.8" transform="rotate(15 17.5 9)" />
            </svg>
            {spotlight ? "More of Rob's Picks" : "Rob's Picks"}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {picks.map((e) => (
              <PickCard key={entryKey(e)} entry={e} todayIso={todayIso} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
