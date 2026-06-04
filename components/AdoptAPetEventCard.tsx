import { CollapsedEvent } from "@/lib/types";
import { generateEventSlug, townSlug } from "@/lib/slugs";
import { getTownContent } from "@/app/towns/town-content";
import {
  parseDate,
  formatShortWeekday,
  formatDayOfMonth,
  formatShortMonth,
} from "@/lib/date-utils";
import Link from "next/link";

// Warm "Adopt-a-Pet Day" palette — kept local so these joyful pet-day tones
// don't leak into the site's earthy token set (mirrors PatrioticEventCard).
const GRAD = "linear-gradient(135deg, #C25733 0%, #A8442A 55%, #8F3A26 100%)";
const DEEP = "#7A3320"; // deep cocoa-coral — the anchor pill
const ACCENT = "#B14A2C"; // coral for the white date-card text

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function Paw({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <ellipse cx="12" cy="15.5" rx="5" ry="4.5" />
      <ellipse cx="6.5" cy="9" rx="2.2" ry="2.8" transform="rotate(-15 6.5 9)" />
      <ellipse cx="10" cy="6.5" rx="2" ry="2.8" transform="rotate(-5 10 6.5)" />
      <ellipse cx="14" cy="6.5" rx="2" ry="2.8" transform="rotate(5 14 6.5)" />
      <ellipse cx="17.5" cy="9" rx="2.2" ry="2.8" transform="rotate(15 17.5 9)" />
    </svg>
  );
}

/**
 * Bespoke warm card for Adopt-a-Pet Day. Same structural anatomy as EventCard —
 * full-card Link overlay, date block, content column — recolored into a joyful,
 * pet-celebrating treatment (paw-print field instead of the thumbnail) so it
 * stops the scroll without feeling like a different site. Selected via
 * isAdoptAPetEvent() in EventCard.
 */
export default function AdoptAPetEventCard({
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
      style={{ background: GRAD, borderLeft: `4px solid ${DEEP}` }}
    >
      {/* Paw-print trail — the pet-day answer to the parade star field. A little
          trotting trail across the top, plus a big ghost paw off the corner. */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <Paw className="absolute -right-5 -top-5 h-28 w-28 text-white/10" />
        <Paw className="absolute right-28 top-4 h-7 w-7 -rotate-[18deg] text-white/15" />
        <Paw className="absolute right-40 top-9 h-5 w-5 rotate-6 text-white/[0.12]" />
        <Paw className="absolute bottom-2 right-7 h-9 w-9 rotate-12 text-white/[0.13]" />
      </div>

      <Link
        href={`/events/${slug}`}
        aria-label={event.name}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span className="sr-only">{event.name}</span>
      </Link>

      {/* Date block — white card, coral weekday/month, deep day */}
      <div className="relative z-[1] flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-white py-2.5 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: ACCENT }}>
          {dayOfWeek}
        </span>
        <span className="font-display text-2xl font-extrabold" style={{ color: DEEP }}>
          {formatDayOfMonth(dateObj)}
        </span>
        <span className="text-xs font-semibold" style={{ color: ACCENT }}>
          {formatShortMonth(dateObj)}
        </span>
      </div>

      {/* Content */}
      <div className="relative z-[1] min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
            style={{ backgroundColor: DEEP }}
          >
            <Paw className="h-3 w-3" />
            Adopt-a-Pet Day
          </span>
          {isUpNext && (
            <span className="font-display inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              Up Next
            </span>
          )}
          {event.robs_pick && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              <Paw className="h-3 w-3" />
              Rob&apos;s Pick
            </span>
          )}
          {event.cost_tier === "free" && (
            <span
              className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "#8F3A26" }}
            >
              Free
            </span>
          )}
        </div>

        <h3 className="mt-1.5 font-display text-lg font-bold leading-tight text-white">
          {event.name}
        </h3>

        {/* Themed hook — celebrates the day's whole roster of dogs and cats */}
        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-white/75">
          Fee-waived adoptions · dogs, cats &amp; a dozen kittens
        </p>

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

      {/* Paw medallion in the thumbnail slot — a clear, friendly dog-and-cat
          paw motif. The shelter's poster is portrait and reads poorly shrunk to
          a tiny square (and isn't an allowed next/image host), so the detail
          page carries it full-size while the card leans into the theme. */}
      <div className="relative z-[1] hidden shrink-0 items-center sm:flex">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full bg-cream shadow-sm ring-1 ring-white/40"
          style={{ color: DEEP }}
        >
          <Paw className="h-10 w-10" />
        </div>
      </div>
    </article>
  );
}
