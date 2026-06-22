import { CollapsedEvent, CATEGORY_LABELS, EventCategory } from "@/lib/types";
import { generateEventSlug, townSlug } from "@/lib/slugs";
import { isPatrioticCard, isAdoptAPetEvent, isClassicRockEvent } from "@/lib/featured-events";
import PatrioticEventCard from "@/components/PatrioticEventCard";
import AdoptAPetEventCard from "@/components/AdoptAPetEventCard";
import ClassicRockEventCard from "@/components/ClassicRockEventCard";
import { getTownContent } from "@/app/towns/town-content";
import { canOptimizeImage } from "@/lib/image-hosts";
import { weatherQualifier } from "@/lib/weather-conditions";
import { resolveEventWeather, type TownForecasts } from "@/lib/weather";
import WeatherChip from "@/components/WeatherChip";
import {
  parseDate,
  formatShortWeekday,
  formatDayOfMonth,
  formatShortMonth,
  formatShortMonthDay,
} from "@/lib/date-utils";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";

// Lazy-load LiveBadge: it's in every card, sets up intervals, and isn't
// needed for the initial render. Loading it async prevents it from blocking
// hydration of the event links above it.
const LiveBadge = dynamic(() => import("@/components/LiveBadge"), {
  ssr: false,
});

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

// Scan-level cost label. `unknown` returns null (show nothing) — we never imply
// an event is free when we just don't know.
function costBadgeLabel(event: CollapsedEvent): string | null {
  switch (event.cost_tier) {
    case "free":
      return "Free";
    case "paid":
      return event.price && /\$|\d/.test(event.price) ? event.price : "Ticketed";
    case "donation":
      return "Pay what you can";
    case "varies":
      return event.price && /\$/.test(event.price) ? event.price : "Ticketed";
    default:
      return null;
  }
}

const ORG_LABELS: Record<string, string> = {
  "moose-lodge": "Moose Lodge",
  "sequoia-woods": "Sequoia Woods",
  "bear-valley": "Bear Valley",
  "blue-lake-springs": "Blue Lake Springs",
  "watering-hole": "The Watering Hole",
  "gocalaveras": "GoCalaveras",
  "visit-murphys": "Visit Murphys",
};

const CATEGORY_IMAGES: Record<EventCategory, string> = {
  live_music: "/images/live_music.svg",
  festival: "/images/festival.svg",
  civic: "/images/civic.svg",
  hike_walk: "/images/hike_walk.svg",
  kids: "/images/kids.svg",
  wine: "/images/wine.svg",
  games: "/images/games.svg",
  fine_arts: "/images/fine_arts.svg",
  other: "/images/other.svg",
};

const CATEGORY_ACCENT_COLORS: Record<EventCategory, string> = {
  live_music: "#D4855C",
  festival: "#8B9E7E",
  civic: "#5A8FA8",
  hike_walk: "#6B8E4E",
  kids: "#E0A33E",
  wine: "#8B3A4E",
  games: "#4E6E8B",
  fine_arts: "#C4922A",
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
  if (venueLower.includes("moose lodge"))
    return event.visibility === "private"
      ? "/images/moose_members.svg"
      : "/images/lodge.jpg";
  if (venueLower.includes("fairgrounds")) return "/images/fairgrounds.jpg";
  if (venueLower.includes("watering hole")) return "/images/brewery.svg";
  if (venueLower.includes("snowflake") || venueLower.includes("blue lake bistro") || venueLower.includes("bls ")) return "/images/lodge.jpg";

  // 3. Event name keyword matching for community events
  const nameLower = event.name.toLowerCase();
  if (nameLower.includes("car show") || nameLower.includes("classic car"))
    return "/images/car_show.svg";
  if (nameLower.includes("parade")) return "/images/parade.svg";

  // 4. Category-specific refinements
  if (event.category === "live_music") {
    if (venueLower.includes("winery") || venueLower.includes("vineyard"))
      return "/images/wine.svg";
    return "/images/live_music.svg";
  }

  // 5. Category fallback
  return CATEGORY_IMAGES[event.category];
}

export default function EventCard({
  event,
  isUpNext = false,
  forecastsByTown = null,
}: {
  event: CollapsedEvent;
  isUpNext?: boolean;
  forecastsByTown?: TownForecasts | null;
}) {
  // Marquee patriotic events get a fully bespoke card.
  if (isPatrioticCard(event)) {
    return <PatrioticEventCard event={event} isUpNext={isUpNext} />;
  }

  // Adopt-a-Pet Day gets its own warm, dogs-and-cats card.
  if (isAdoptAPetEvent(event)) {
    return <AdoptAPetEventCard event={event} isUpNext={isUpNext} />;
  }

  // The Flashback concert at the Moose Lodge gets a classic-rock card.
  if (isClassicRockEvent(event)) {
    return <ClassicRockEventCard event={event} isUpNext={isUpNext} />;
  }

  const isPrivate = event.visibility === "private";
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

  const hasDateRange = event.isCollapsed && event.endDate;
  const endDateObj = hasDateRange ? parseDate(event.endDate!) : null;
  const sameMonth =
    endDateObj && formatShortMonth(dateObj) === formatShortMonth(endDateObj);

  const accentColor = CATEGORY_ACCENT_COLORS[event.category];

  const townHasPage = getTownContent(townSlug(event.town)) !== null;

  const thumbnailSrc = getEventImage(event);

  // Weather chip on every event that has a forecast for its town + date. We look
  // up THIS event's town (Copperopolis at ~850 ft and Bear Valley at ~7,000 ft
  // have wildly different weather) and resolve to the temp at the event's start
  // hour. NWS covers ~7 days, so events further out just have no chip.
  const townForecast = forecastsByTown?.[event.town] ?? null;
  const weather = resolveEventWeather(townForecast, event);
  const weatherCopy = weather ? weatherQualifier(weather) : null;

  return (
    <article
      className={`card-warm group relative flex gap-4 overflow-hidden rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 sm:p-5 [&_*]:pointer-events-none [&_a]:pointer-events-auto ${
        isUpNext
          ? "border-earth/20 bg-white ring-1 ring-earth/10"
          : isPrivate
            ? "border-stone-light/30 bg-earth/[0.02]"
            : "border-stone-light/30 bg-white hover:border-sage/40"
      }`}
      style={{ borderLeftWidth: "4px", borderLeftColor: accentColor }}
    >
      <Link
        href={`/events/${slug}`}
        aria-label={event.name}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine"
      >
        <span className="sr-only">{event.name}</span>
      </Link>

      {/* Date block */}
      <div
        className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-lg py-2.5 ${
          isUpNext ? "bg-earth/8" : "bg-forest/5"
        }`}
      >
        {hasDateRange ? (
          <>
            <span className="text-[11px] font-semibold text-pine">
              {formatShortMonthDay(dateObj)}
            </span>
            <span className="text-[10px] leading-tight text-stone">—</span>
            <span className="text-[11px] font-semibold text-pine">
              {sameMonth
                ? formatDayOfMonth(endDateObj!)
                : formatShortMonthDay(endDateObj!)}
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
            <span className="font-display text-lg font-bold text-forest">
              {formatDayOfMonth(dateObj)}
            </span>
            <span className="text-xs text-stone">
              {formatShortMonth(dateObj)}
            </span>
          </>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-2">
          <LiveBadge
            eventDate={event.date}
            startTime={event.start_time}
            endTime={event.end_time}
          />
          {isUpNext && (
            <span className="font-display inline-flex items-center gap-1 rounded-full bg-earth/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-earth">
              Up Next
            </span>
          )}
          {event.robs_pick && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <ellipse cx="12" cy="15.5" rx="5" ry="4.5"/>
                <ellipse cx="6.5" cy="9" rx="2.2" ry="2.8" transform="rotate(-15 6.5 9)"/>
                <ellipse cx="10" cy="6.5" rx="2" ry="2.8" transform="rotate(-5 10 6.5)"/>
                <ellipse cx="14" cy="6.5" rx="2" ry="2.8" transform="rotate(5 14 6.5)"/>
                <ellipse cx="17.5" cy="9" rx="2.2" ry="2.8" transform="rotate(15 17.5 9)"/>
              </svg>
              Rob&apos;s Pick
            </span>
          )}
          <h3
            className={`font-semibold transition-colors group-hover:text-pine ${
              isUpNext ? "text-lg text-forest" : "text-forest"
            }`}
          >
            {event.name}
          </h3>
          {event.community_sourced && (
            <span
              title="Submitted by a Hwy 4 neighbor"
              className="inline-flex items-center gap-1 rounded-full bg-pine/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-pine"
            >
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
                  d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.34"
                />
              </svg>
              Community sourced
            </span>
          )}
          <span
            className={`badge-${event.category} inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
          >
            {CATEGORY_LABELS[event.category]}
          </span>
          {event.cost_tier === "free" ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-sage/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pine">
              Free
            </span>
          ) : (
            costBadgeLabel(event) && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-earth/10 px-2 py-0.5 text-xs font-medium text-earth">
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
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {costBadgeLabel(event)}
              </span>
            )
          )}
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
          {event.verification_status === "needs_verification" && (
            <span className="group/tip relative inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Date unconfirmed
              <svg
                className="h-3 w-3 opacity-70"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-56 -translate-x-1/2 rounded-lg bg-forest px-3 py-2 text-center text-[11px] leading-snug font-normal text-white shadow-lg group-hover/tip:block">
                We couldn&rsquo;t confirm this date on the organizer&rsquo;s site. Check with them before heading out.
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-forest" />
              </span>
            </span>
          )}
          {isPrivate && (
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
              Members &amp; Guests
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
            className={`mt-1.5 text-[15px] text-stone-600 ${isUpNext ? "line-clamp-3" : "line-clamp-2"}`}
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

        {/* Meta row: time leads (the feed is ordered chronologically), then place.
            Time is a fixed-width, tabular column so start times align down the feed. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
          {timeRange && (
            <span className="flex shrink-0 items-center gap-1 tabular-nums sm:min-w-[8.5rem]">
              <svg
                className="h-3.5 w-3.5 shrink-0"
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

          {weather && (
            <WeatherChip weather={weather} qualifier={weatherCopy} />
          )}

          {/* Place: town leads (the geographic decision unit), venue second. */}
          <span className="flex items-center gap-1">
            <svg
              className="h-3.5 w-3.5 shrink-0"
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
            <span>
              {townHasPage ? (
                <Link
                  href={`/towns/${townSlug(event.town)}`}
                  className="relative z-20 underline decoration-stone-light/60 underline-offset-2 hover:text-pine hover:decoration-pine"
                >
                  {event.town}
                </Link>
              ) : (
                event.town
              )}
              <span className="px-1 text-stone-light">·</span>
              {event.venue_name}
            </span>
          </span>
        </div>
      </div>

      {/* Thumbnail — vertically centered so it lines up with the chevron. */}
      <div className="hidden shrink-0 self-center sm:block">
        <div className="relative h-20 w-20 overflow-hidden rounded-lg">
          {canOptimizeImage(thumbnailSrc) ? (
            <Image
              src={thumbnailSrc}
              alt=""
              fill
              className="object-cover"
              sizes="80px"
              loading="lazy"
            />
          ) : (
            // External / non-allowlisted host: a plain <img> sidesteps
            // next/image's host allowlist so a bad image can't 500 the page.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailSrc}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>
      </div>

      {/* Disclosure chevron: signals the whole card opens the event's detail
          page. On mobile the thumbnail is hidden, so this becomes the rightmost
          element — the iOS "this row opens" cue, exactly where the thumb looks. */}
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center self-center text-stone-light transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-stone"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </div>
    </article>
  );
}
