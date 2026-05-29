import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Hwy4Event, CATEGORY_LABELS } from "@/lib/types";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { TOWN_INFO } from "@/lib/towns";
import { resolveDisplayAddress, buildGeocodeQuery } from "@/lib/address";
import { buildEventOffer } from "@/lib/schema";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import EventMap from "@/components/EventMapStatic";
import LiveBadge from "@/components/LiveBadge";
import ShareButton from "@/components/ShareButton";

export const revalidate = 3600;

const EVENT_COLUMNS =
  "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, cost_tier, event_url, source_url, source_name, visibility, org_slug, importance, robs_pick";
const PAGE_SIZE = 60;

const matchSlug = (events: Hwy4Event[] | null, slug: string): Hwy4Event | null =>
  events?.find((e) => generateEventSlug(e.name, e.date, e.town) === slug) ?? null;

/**
 * Resolve an event from its computed slug. Wrapped in React cache() so the
 * page and generateMetadata share a single fetch per request. The slug embeds
 * the event date (YYYY-MM-DD), so we query just that date — a handful of rows —
 * instead of scanning the whole upcoming table. Falls back to a paginated scan
 * only if the date can't be parsed or the row isn't found.
 */
const findEventBySlug = cache(async (slug: string): Promise<Hwy4Event | null> => {
  const { supabase } = await import("@/lib/supabase");

  const dateMatch = slug.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) {
    const { data } = await supabase
      .from("hwy4_events")
      .select(EVENT_COLUMNS)
      .eq("date", dateMatch[0])
      .neq("status", "cancelled");
    const hit = matchSlug(data as unknown as Hwy4Event[] | null, slug);
    if (hit) return hit;
  }

  // Fallback: scan upcoming events (rare — only if the slug has no parseable date).
  const today = new Date().toISOString().split("T")[0];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hwy4_events")
      .select(EVENT_COLUMNS)
      .gte("date", today)
      .neq("status", "cancelled")
      .order("date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    const hit = matchSlug(data as unknown as Hwy4Event[], slug);
    if (hit) return hit;
    if (data.length < PAGE_SIZE) break;
  }
  return null;
});

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await findEventBySlug(slug);
  if (!event) return { title: "Event Not Found" };

  const dateStr = format(parseISO(event.date), "MMMM d, yyyy");
  const title = `${event.name} — ${dateStr} in ${event.town}`;
  const description = event.description
    ? event.description.slice(0, 155)
    : `${event.name} at ${event.venue_name} in ${event.town}, CA on ${dateStr}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/events/${slug}`,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}/events/${slug}`,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

function EventJsonLd({ event, slug }: { event: Hwy4Event; slug: string }) {
  const displayAddress = resolveDisplayAddress(event.address, event.town);
  const offer = buildEventOffer(
    event,
    event.event_url || `${SITE_URL}/events/${slug}`
  );
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    ...(event.description && { description: event.description }),
    startDate: event.start_time
      ? `${event.date}T${event.start_time}`
      : event.date,
    ...(event.end_time && { endDate: `${event.date}T${event.end_time}` }),
    location: {
      "@type": "Place",
      name: event.venue_name,
      address: {
        "@type": "PostalAddress",
        ...(displayAddress && { streetAddress: displayAddress }),
        addressLocality: event.town,
        addressRegion: "CA",
        addressCountry: "US",
      },
    },
    ...(offer && { offers: offer }),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus:
      event.status === "tentative"
        ? "https://schema.org/EventPostponed"
        : "https://schema.org/EventScheduled",
    ...(event.artists &&
      event.artists.length > 0 && {
        performer: event.artists.map((artist) => ({
          "@type": "Person",
          name: artist,
        })),
      }),
    organizer: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function EventPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await findEventBySlug(slug);
  if (!event) notFound();

  const dateObj = parseISO(event.date);
  const dateStr = format(dateObj, "EEEE, MMMM d, yyyy");
  const startTime = formatTime(event.start_time);
  const endTime = formatTime(event.end_time);
  const timeRange = startTime
    ? endTime
      ? `${startTime} – ${endTime}`
      : startTime
    : null;
  const displayAddress = resolveDisplayAddress(event.address, event.town);
  // Pure string (no network) — the map geocodes it lazily on tap so the page
  // render never blocks on an external request.
  const geocodeQuery = buildGeocodeQuery(event.address, event.town);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <EventJsonLd event={event} slug={slug} />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="truncate text-stone-light">{event.name}</li>
        </ol>
      </nav>

      <article>
        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <LiveBadge
              eventDate={event.date}
              startTime={event.start_time}
              endTime={event.end_time}
            />
            <span
              className={`badge-${event.category} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
            >
              {CATEGORY_LABELS[event.category]}
            </span>
            {event.status === "tentative" && (
              <span className="inline-flex items-center rounded-full bg-sunset/10 px-2 py-0.5 text-xs font-medium text-sunset">
                Tentative
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-3xl font-bold text-forest">{event.name}</h1>
            <div className="shrink-0 pt-1">
              <ShareButton
                url={`${SITE_URL}/events/${slug}`}
                title={event.name}
                text={`${event.name} at ${event.venue_name} in ${event.town}`}
              />
            </div>
          </div>
        </header>

        <dl className="grid gap-3 sm:grid-cols-2 mb-6 text-sm">
          <div className="rounded-lg border border-stone-light/30 bg-white p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-light">
              Date
            </dt>
            <dd className="mt-0.5 font-medium text-forest">{dateStr}</dd>
          </div>
          {timeRange && (
            <div className="rounded-lg border border-stone-light/30 bg-white p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-light">
                Time
              </dt>
              <dd className="mt-0.5 font-medium text-forest">{timeRange}</dd>
            </div>
          )}
          <div className="rounded-lg border border-stone-light/30 bg-white p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-light">
              Venue
            </dt>
            <dd className="mt-0.5 font-medium text-forest">
              {event.venue_name}
            </dd>
          </div>
          <div className="rounded-lg border border-stone-light/30 bg-white p-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-stone-light">
              Location
            </dt>
            <dd className="mt-0.5 font-medium text-forest">
              {event.town}, California
              {displayAddress && (
                <span className="block text-xs text-stone">
                  {displayAddress}
                </span>
              )}
              {TOWN_INFO[event.town] && (
                <span className="mt-1 block text-xs text-stone">
                  {TOWN_INFO[event.town].elevation.toLocaleString()} ft
                </span>
              )}
            </dd>
          </div>
          {event.price && (
            <div className="rounded-lg border border-stone-light/30 bg-white p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-stone-light">
                Price
              </dt>
              <dd className="mt-0.5 font-medium text-forest">{event.price}</dd>
            </div>
          )}
        </dl>

        <EventMap
          town={event.town}
          venueName={event.venue_name}
          address={event.address}
          geocodeQuery={geocodeQuery}
        />

        {event.description && (
          <section className="mb-6">
            <h2 className="font-display mb-2 text-lg font-semibold text-forest">
              About This Event
            </h2>
            <p className="leading-relaxed text-stone">{event.description}</p>
          </section>
        )}

        {event.artists && event.artists.length > 0 && (
          <section className="mb-6">
            <h2 className="font-display mb-2 text-lg font-semibold text-forest">
              Performers
            </h2>
            <ul className="flex flex-wrap gap-2">
              {event.artists.map((artist) => (
                <li
                  key={artist}
                  className="rounded-md bg-sunset/8 px-3 py-1 text-sm font-medium text-earth"
                >
                  {artist}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mb-6 flex flex-wrap gap-3">
          {event.event_url && (
            <a
              href={event.event_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-forest px-4 py-2 text-sm font-medium text-white hover:bg-pine transition-colors"
            >
              Visit Event Page
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
        </div>
      </article>

      <div className="mt-8 border-t border-stone-light/30 pt-6">
        <Link
          href="/"
          className="text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to all events
        </Link>
      </div>
    </main>
  );
}
