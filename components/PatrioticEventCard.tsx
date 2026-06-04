import { CollapsedEvent } from "@/lib/types";
import { isParadeEvent } from "@/lib/featured-events";
import { generateEventSlug, townSlug } from "@/lib/slugs";
import { getTownContent } from "@/app/towns/town-content";
import {
  parseDate,
  formatShortWeekday,
  formatDayOfMonth,
  formatShortMonth,
} from "@/lib/date-utils";
import Link from "next/link";

// Old Glory palette — kept here so the card reads unmistakably patriotic without
// leaking flag colors into the site's earthy token set.
const NAVY = "#3C3B6E"; // Old Glory Blue
const RED = "#B22234"; // Old Glory Red

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function Star({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2l2.95 6.18 6.8.78-5.04 4.6 1.36 6.7L12 17.6 5.93 20.86l1.36-6.7L2.25 9.56l6.8-.78L12 2z" />
    </svg>
  );
}

/**
 * Bespoke red/white/blue card for marquee patriotic events (the Arnold
 * Independence Day Parade). Same structural anatomy as EventCard — full-card
 * Link overlay, date block, content column, thumbnail flourish — recolored into
 * an Old Glory theme so it stops the scroll without feeling like a different
 * site. Selected via isPatrioticCard() in EventCard.
 */
export default function PatrioticEventCard({
  event,
  isUpNext = false,
}: {
  event: CollapsedEvent;
  isUpNext?: boolean;
}) {
  const dateObj = parseDate(event.date);
  const dayOfWeek = formatShortWeekday(dateObj);
  const slug = generateEventSlug(event.name, event.date, event.town);

  const startTime = formatTime(event.start_time);
  const endTime = formatTime(event.end_time);
  const timeRange = startTime
    ? endTime
      ? `${startTime} - ${endTime}`
      : startTime
    : null;

  const townHasPage = getTownContent(townSlug(event.town)) !== null;

  return (
    <article
      className="group relative flex gap-4 overflow-hidden rounded-xl p-4 text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl sm:p-5 [&_*]:pointer-events-none [&_a]:pointer-events-auto"
      style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #2b2a52 55%, #232248 100%)`,
        borderLeft: `4px solid ${RED}`,
      }}
    >
      {/* Stripe band across the very top */}
      <div
        className="absolute inset-x-0 top-0 h-1.5"
        style={{
          background:
            "repeating-linear-gradient(90deg, #B22234 0 18px, #FFFFFF 18px 36px)",
        }}
      />

      {/* Faint star field, top-right */}
      <div className="absolute -right-2 -top-1 flex gap-1 text-white/10">
        <Star className="h-16 w-16" />
        <Star className="mt-4 h-10 w-10" />
      </div>

      <Link
        href={`/events/${slug}`}
        aria-label={event.name}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span className="sr-only">{event.name}</span>
      </Link>

      {/* Date block — white card, red weekday, navy day */}
      <div className="relative z-[1] flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-white py-2.5 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: RED }}>
          {dayOfWeek}
        </span>
        <span className="font-display text-2xl font-extrabold" style={{ color: NAVY }}>
          {formatDayOfMonth(dateObj)}
        </span>
        <span className="text-xs font-semibold" style={{ color: RED }}>
          {formatShortMonth(dateObj)}
        </span>
      </div>

      {/* Content */}
      <div className="relative z-[1] min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
            style={{ backgroundColor: RED }}
          >
            <Star className="h-3 w-3" />
            July 4th
          </span>
          {isUpNext && (
            <span className="font-display inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              Up Next
            </span>
          )}
          {event.robs_pick && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <ellipse cx="12" cy="15.5" rx="5" ry="4.5" />
                <ellipse cx="6.5" cy="9" rx="2.2" ry="2.8" transform="rotate(-15 6.5 9)" />
                <ellipse cx="10" cy="6.5" rx="2" ry="2.8" transform="rotate(-5 10 6.5)" />
                <ellipse cx="14" cy="6.5" rx="2" ry="2.8" transform="rotate(5 14 6.5)" />
                <ellipse cx="17.5" cy="9" rx="2.2" ry="2.8" transform="rotate(15 17.5 9)" />
              </svg>
              Rob&apos;s Pick
            </span>
          )}
          {event.cost_tier === "free" && (
            <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: NAVY }}>
              Free
            </span>
          )}
        </div>

        <h3 className="mt-1.5 font-display text-lg font-bold leading-tight text-white">
          {event.name}
        </h3>

        {/* The parade's official theme line — parade-only; other patriotic
            features (e.g. the arts & crafts festival) keep their own subtitle. */}
        {isParadeEvent(event) && (
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-white/70">
            Theme: Stars, Stripes &amp; 250 Years
          </p>
        )}

        {event.description && (
          <p className="mt-1.5 line-clamp-2 text-sm text-white/80">
            {event.description}
          </p>
        )}

        {/* Meta row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75">
          <span className="flex items-center gap-1">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {event.venue_name},{" "}
            {townHasPage ? (
              <Link
                href={`/towns/${townSlug(event.town)}`}
                className="relative z-20 underline decoration-white/40 underline-offset-2 hover:decoration-white"
              >
                {event.town}
              </Link>
            ) : (
              event.town
            )}
          </span>

          {timeRange && (
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {timeRange}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
