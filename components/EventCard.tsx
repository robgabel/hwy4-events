import { CollapsedEvent, CATEGORY_LABELS, EventCategory } from "@/lib/types";
import { generateEventSlug } from "@/lib/slugs";
import { format, parseISO } from "date-fns";
import Image from "next/image";
import Link from "next/link";

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

const ORG_LABELS: Record<string, string> = {
  "moose-lodge": "Moose Lodge",
  "sequoia-woods": "Sequoia Woods",
  "bear-valley": "Bear Valley",
};

const CATEGORY_IMAGES: Record<EventCategory, string> = {
  live_music: "/images/live_music.jpg",
  festival: "/images/festival.jpg",
  civic: "/images/civic.jpg",
  resort: "/images/resort.jpg",
  lodge: "/images/lodge.jpg",
  other: "/images/other.jpg",
};

const CATEGORY_ACCENT_COLORS: Record<EventCategory, string> = {
  live_music: "#D4855C",
  festival: "#8B9E7E",
  civic: "#5A8FA8",
  resort: "#A09484",
  lodge: "#6B4226",
  other: "#C4B8AA",
};

function getEventImage(event: CollapsedEvent): string {
  // 1. Per-event override from database
  if (event.image_url) return event.image_url;

  // 2. Venue-specific match
  const venueLower = event.venue_name.toLowerCase();
  if (venueLower.includes("ironstone")) return "/images/ironstone.jpg";
  if (venueLower.includes("bear valley")) return "/images/bear_valley.jpg";
  if (venueLower.includes("sequoia woods")) return "/images/sequoia_woods.jpg";
  if (venueLower.includes("moose lodge")) return "/images/lodge.jpg";
  if (venueLower.includes("fairgrounds")) return "/images/fairgrounds.jpg";

  // 3. Category-specific refinements
  if (event.category === "live_music") {
    if (venueLower.includes("winery") || venueLower.includes("vineyard"))
      return "/images/wine_glasses.jpg";
    return "/images/acoustic_guitar.jpg";
  }

  // 4. Category fallback
  return CATEGORY_IMAGES[event.category];
}

export default function EventCard({
  event,
  isUpNext = false,
}: {
  event: CollapsedEvent;
  isUpNext?: boolean;
}) {
  const isPrivate = event.visibility === "private";
  const dateObj = parseISO(event.date);
  const dayOfWeek = format(dateObj, "EEE");
  const slug = generateEventSlug(event.name, event.date, event.town);

  const startTime = formatTime(event.start_time);
  const endTime = formatTime(event.end_time);
  const timeRange = startTime
    ? endTime
      ? `${startTime} - ${endTime}`
      : startTime
    : null;

  const hasDateRange = event.isCollapsed && event.endDate;
  const endDateObj = hasDateRange ? parseISO(event.endDate!) : null;
  const sameMonth =
    endDateObj && format(dateObj, "MMM") === format(endDateObj, "MMM");

  const accentColor = CATEGORY_ACCENT_COLORS[event.category];

  return (
    <article
      className={`group relative flex gap-4 overflow-hidden rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:p-5 ${
        isUpNext
          ? "border-pine/20 bg-white shadow-md ring-1 ring-pine/10"
          : isPrivate
            ? "border-stone-light/30 bg-earth/[0.02]"
            : "border-stone-light/30 bg-white hover:border-sage/40"
      }`}
      style={{ borderLeftWidth: "4px", borderLeftColor: accentColor }}
    >
      {/* Date block */}
      <div
        className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-lg py-2.5 ${
          isUpNext ? "bg-pine/10" : "bg-forest/5"
        }`}
      >
        {hasDateRange ? (
          <>
            <span className="text-[11px] font-semibold text-pine">
              {format(dateObj, "MMM d")}
            </span>
            <span className="text-[10px] leading-tight text-stone">—</span>
            <span className="text-[11px] font-semibold text-pine">
              {sameMonth
                ? format(endDateObj!, "d")
                : format(endDateObj!, "MMM d")}
            </span>
            <span className="mt-1 rounded-full bg-forest/10 px-1.5 py-0.5 text-[9px] font-medium text-forest">
              {event.dayCount}d
            </span>
          </>
        ) : (
          <>
            <span className="text-xs font-medium uppercase text-pine">
              {dayOfWeek}
            </span>
            <span className="text-lg font-bold text-forest">
              {format(dateObj, "d")}
            </span>
            <span className="text-xs text-stone">
              {format(dateObj, "MMM")}
            </span>
          </>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-2">
          {isUpNext && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pine/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pine">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pine" />
              </span>
              Up Next
            </span>
          )}
          <h3
            className={`font-semibold transition-colors group-hover:text-pine ${
              isUpNext ? "text-lg text-forest" : "text-forest"
            }`}
          >
            <Link href={`/events/${slug}`} className="hover:underline">
              {event.name}
            </Link>
          </h3>
          <span
            className={`badge-${event.category} inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
          >
            {CATEGORY_LABELS[event.category]}
          </span>
          {event.status === "tentative" && (
            <span className="group/tip relative inline-flex items-center gap-1 rounded-full bg-sunset/10 px-2 py-0.5 text-xs font-medium text-sunset">
              Tentative
              <svg
                className="h-3 w-3 opacity-60"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.01"
                />
              </svg>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-48 -translate-x-1/2 rounded-lg bg-forest px-3 py-2 text-center text-[11px] leading-snug font-normal text-white shadow-lg group-hover/tip:block">
                Date or details not yet confirmed by the organizer
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-forest" />
              </span>
            </span>
          )}
          {isPrivate && event.org_slug && (
            <span className="inline-flex items-center gap-1 rounded-full bg-earth/10 px-2 py-0.5 text-xs font-medium text-earth">
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              {ORG_LABELS[event.org_slug] || event.org_slug}
            </span>
          )}
        </div>

        {event.description && (
          <p
            className={`mt-1.5 text-sm text-stone ${isUpNext ? "line-clamp-3" : "line-clamp-2"}`}
          >
            {event.description}
          </p>
        )}

        {/* Artists */}
        {event.artists && event.artists.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {event.artists.map((artist) => (
              <span
                key={artist}
                className="rounded-md bg-sunset/8 px-2 py-0.5 text-xs font-medium text-earth"
              >
                {artist}
              </span>
            ))}
          </div>
        )}

        {/* Meta row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone">
          <span className="flex items-center gap-1">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            {event.venue_name}, {event.town}
          </span>

          {timeRange && (
            <span className="flex items-center gap-1">
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {timeRange}
            </span>
          )}

          {event.price && (
            <span className="flex items-center gap-1">
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {event.price}
            </span>
          )}
        </div>
      </div>

      {/* Thumbnail */}
      <div className="hidden shrink-0 sm:block">
        <div className="relative h-20 w-20 overflow-hidden rounded-lg">
          <Image
            src={getEventImage(event)}
            alt=""
            fill
            className="object-cover"
            sizes="80px"
          />
        </div>
      </div>
    </article>
  );
}
