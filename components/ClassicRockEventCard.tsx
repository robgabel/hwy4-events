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

// Classic-rock palette — kept local so these stage-light tones don't leak into
// the site's earthy token set (mirrors PatrioticEventCard / AdoptAPetEventCard).
const GRAD = "linear-gradient(135deg, #2A1733 0%, #3A1230 52%, #531427 100%)"; // amp-dark plum to rock red
const AMBER = "#F2B544"; // warm stage amber — the anchor pill + date accents
const HOT = "#E5484D"; // hot-pink-red neon

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function Vinyl({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <circle cx="12" cy="12" r="8" stroke="#000" strokeOpacity="0.25" strokeWidth="0.6" />
      <circle cx="12" cy="12" r="6" stroke="#000" strokeOpacity="0.25" strokeWidth="0.6" />
      <circle cx="12" cy="12" r="3.4" fill="#E5484D" />
      <circle cx="12" cy="12" r="0.9" fill="#000" fillOpacity="0.5" />
    </svg>
  );
}

/**
 * Bespoke classic-rock card for the Flashback concert at the Moose Lodge. Same
 * structural anatomy as EventCard — full-card Link overlay, date block, content
 * column — recolored into a stage-light treatment (spinning-vinyl motif in the
 * thumbnail slot) so it stops the scroll without feeling like a different site.
 * Selected via isClassicRockEvent() in EventCard.
 */
export default function ClassicRockEventCard({
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
      style={{ background: GRAD, borderLeft: `4px solid ${AMBER}` }}
    >
      {/* Equalizer / stage-light flourish, top-right */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <Vinyl className="absolute -right-6 -top-6 h-28 w-28 text-white/10" />
        <div className="absolute right-4 top-4 flex items-end gap-1 opacity-25">
          <span className="block w-1 rounded-full" style={{ height: 10, backgroundColor: AMBER }} />
          <span className="block w-1 rounded-full" style={{ height: 18, backgroundColor: HOT }} />
          <span className="block w-1 rounded-full" style={{ height: 8, backgroundColor: AMBER }} />
          <span className="block w-1 rounded-full" style={{ height: 14, backgroundColor: HOT }} />
        </div>
      </div>

      <Link
        href={`/events/${slug}`}
        aria-label={event.name}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span className="sr-only">{event.name}</span>
      </Link>

      {/* Date block — white card, amber weekday/month, plum day */}
      <div className="relative z-[1] flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-white py-2.5 shadow-sm">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: HOT }}>
          {dayOfWeek}
        </span>
        <span className="font-display text-2xl font-extrabold" style={{ color: "#2A1733" }}>
          {formatDayOfMonth(dateObj)}
        </span>
        <span className="text-xs font-semibold" style={{ color: HOT }}>
          {formatShortMonth(dateObj)}
        </span>
      </div>

      {/* Content */}
      <div className="relative z-[1] min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: AMBER, color: "#2A1733" }}
          >
            <Vinyl className="h-3 w-3 text-white" />
            Classic Rock Night
          </span>
          {isUpNext && (
            <span className="font-display inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              Up Next
            </span>
          )}
          {event.robs_pick && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: HOT, color: "white" }}
            >
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
            <span
              className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "#531427" }}
            >
              Free
            </span>
          )}
        </div>

        <h3 className="mt-1.5 font-display text-lg font-bold leading-tight text-white">
          {event.name}
        </h3>

        {/* Themed hook */}
        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide" style={{ color: AMBER }}>
          Live rock &amp; roll at the Moose
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

      {/* Spinning-vinyl medallion in the thumbnail slot */}
      <div className="relative z-[1] hidden shrink-0 items-center sm:flex">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 shadow-sm ring-1 ring-white/30">
          <Vinyl className="h-16 w-16 text-[#1a1020]" />
        </div>
      </div>
    </article>
  );
}
