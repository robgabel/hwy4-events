import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Hwy4Event, CATEGORY_LABELS } from "@/lib/types";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { TOWN_INFO } from "@/lib/towns";
import { resolveDisplayAddress, buildGeocodeQuery } from "@/lib/address";
import { geocodeAddress } from "@/lib/geocode";
import { buildEventOffer } from "@/lib/schema";
import { findEventBySlug } from "@/lib/events";
import { posterKind, posterImageUrl, generatedPosterPath, withSrc, humanizeHost } from "@/lib/poster";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import EventMap from "@/components/EventMapStatic";
import VenueInfo from "@/components/VenueInfo";
import LinkifiedText from "@/components/LinkifiedText";
import LiveBadge from "@/components/LiveBadge";
import ShareButton from "@/components/ShareButton";
import ShareTracker from "@/components/ShareTracker";
import OutboundTracker from "@/components/OutboundTracker";
import type { Hwy4Venue } from "@/lib/types";
import PatrioticEventDetail from "@/components/PatrioticEventDetail";
import PatrioticBanner from "@/components/PatrioticBanner";
import AdoptAPetBanner from "@/components/AdoptAPetBanner";
import { isParadeEvent, isFourthFeatureEvent, isAdoptAPetEvent } from "@/lib/featured-events";
import { resolveEventLinkFromOrgs, promotableVenueUrl, type LinkOrg } from "@/lib/event-link";

export const revalidate = 3600;

const VENUE_COLUMNS =
  "venue_key, canonical, town, address, blurb, place_id, rating, user_ratings_total, phone, website, maps_url, hours, places_synced_at";

const findVenue = cache(async (venueKey: string): Promise<Hwy4Venue | null> => {
  const { supabase } = await import("@/lib/supabase");
  const { data } = await supabase
    .from("hwy4_venues")
    .select(VENUE_COLUMNS)
    .eq("venue_key", venueKey)
    .maybeSingle();
  return (data as unknown as Hwy4Venue) ?? null;
});

const getCanonicalOrgs = cache(async (): Promise<LinkOrg[]> => {
  const { supabase } = await import("@/lib/supabase");
  const { data } = await supabase
    .from("hwy4_orgs")
    .select("slug, display_name, canonical_url, match_patterns")
    .not("canonical_url", "is", null);
  return (data as LinkOrg[] | null) ?? [];
});

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

/** Google Calendar "add event" template link. */
function calendarUrl(event: Hwy4Event): string {
  const d = event.date.replace(/-/g, "");
  const toStamp = (t: string | null) =>
    t ? `${d}T${t.replace(/:/g, "").padEnd(6, "0")}` : null;
  const start = toStamp(event.start_time);
  const end = toStamp(event.end_time);
  const dates = start
    ? `${start}/${end ?? start}`
    : `${d}/${d}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.name,
    dates,
    location: [event.venue_name, event.town, "CA"].filter(Boolean).join(", "),
    details: `Details: ${SITE_URL}/events/${event.id}`,
  });
  return `https://www.google.com/calendar/render?${params.toString()}`;
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

  // The poster is the share image: organizer's own art if supplied, else the
  // generated screenprint. Portrait, so use a summary_large_image-friendly card.
  const posterUrl = posterImageUrl(event, slug);

  return {
    title,
    description,
    alternates: { canonical: `/events/${slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}/events/${slug}`,
      images: [{ url: posterUrl, width: 1080, height: 1350, alt: `${event.name} poster` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [posterUrl],
    },
  };
}

function EventJsonLd({
  event,
  offerUrl,
}: {
  event: Hwy4Event;
  slug: string;
  offerUrl: string;
}) {
  const displayAddress = resolveDisplayAddress(event.address, event.town);
  const offer = buildEventOffer(event, offerUrl);
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

  // Load the venue row before resolving the link: its registry website is the
  // durable "venue canonical" destination (resolver priority #2), but only for
  // single-operator venues — promotableVenueUrl screens out multi-tenant parks
  // and bad Google Places auto-matches.
  const venue = event.venue_key ? await findVenue(event.venue_key) : null;
  const orgs = await getCanonicalOrgs();
  const link = resolveEventLinkFromOrgs(event, orgs, {
    venueUrl: promotableVenueUrl(venue?.canonical, venue?.website),
    venueName: venue?.canonical,
  });
  // JSON-LD offer.url uses the resolved link only when it's durable (organizer/
  // venue/stable source). A non-durable aggregator fallback (GoCalaveras) renders
  // as the visible CTA but never enters structured data — point schema at our own
  // stable page instead, so a churnable permalink can't leak into JSON-LD.
  const offerUrl = link.durable && link.href ? link.href : `${SITE_URL}/events/${slug}`;

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
  const geocodeQuery = buildGeocodeQuery(event.address, event.town);

  const geocoded = geocodeQuery ? await geocodeAddress(geocodeQuery) : null;
  const townData = TOWN_INFO[event.town];
  const mapLat = geocoded?.lat ?? townData?.lat ?? null;
  const mapLng = geocoded?.lng ?? townData?.lng ?? null;
  const mapZoom = geocoded ? 15 : townData?.mapZoom ?? 13;

  // The Arnold parade gets a fully bespoke, parade-specific detail microsite.
  if (isParadeEvent(event)) {
    return (
      <>
        <EventJsonLd event={event} slug={slug} offerUrl={offerUrl} />
        <PatrioticEventDetail
          event={event}
          slug={slug}
          dateStr={dateStr}
          timeRange={timeRange}
          displayAddress={displayAddress}
          geocodeQuery={geocodeQuery}
          mapLat={mapLat}
          mapLng={mapLng}
          mapZoom={mapZoom}
          linkHref={link.href}
        />
      </>
    );
  }

  // The poster artifact: organizer's own art (untouched) if supplied, else the
  // generated screenprint. The page uses a relative src so it can be cached/ISR.
  const posterSrc =
    posterKind(event) === "supplied"
      ? (event.image_url as string)
      : generatedPosterPath(slug);
  const downloadHref = withSrc(posterSrc, "pdf");
  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    geocodeQuery || `${event.venue_name}, ${event.town}, CA`
  )}`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <EventJsonLd event={event} slug={slug} offerUrl={offerUrl} />
      <Suspense fallback={null}>
        <ShareTracker slug={slug} />
      </Suspense>
      <OutboundTracker eventId={event.id} />

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

      {isFourthFeatureEvent(event) && <PatrioticBanner town={event.town} />}
      {isAdoptAPetEvent(event) && <AdoptAPetBanner town={event.town} />}

      <article>
        {/* HERO — poster + action rail */}
        <div className="grid gap-8 md:grid-cols-[minmax(0,46%)_1fr] md:items-start">
          {/* The poster */}
          <div>
            <div className="overflow-hidden rounded-xl bg-cream shadow-lg ring-1 ring-stone-light/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={posterSrc}
                alt={`${event.name} — event poster`}
                width={1080}
                height={1350}
                className="block w-full"
                style={{ aspectRatio: "4 / 5", objectFit: "cover" }}
              />
            </div>
            <p className="mt-3 text-center text-sm font-medium text-stone">
              Share or download this poster
            </p>
            <p className="mt-1 text-center text-xs text-stone-light">
              <Link
                href={`/events/${slug}/submit-poster`}
                className="underline underline-offset-2 transition-colors hover:text-pine"
              >
                Organizer? Swap in your own poster
              </Link>
            </p>
          </div>

          {/* Info + actions */}
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
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
              {event.cost_tier === "free" && (
                <span className="inline-flex items-center rounded-full bg-pine px-2.5 py-0.5 text-xs font-semibold text-white">
                  Free
                </span>
              )}
              {event.status === "tentative" && (
                <span className="inline-flex items-center rounded-full bg-sunset/10 px-2 py-0.5 text-xs font-medium text-sunset">
                  Tentative
                </span>
              )}
              {event.community_sourced && (
                <span className="inline-flex items-center rounded-full bg-pine/10 px-2.5 py-0.5 text-xs font-medium text-pine">
                  Community sourced
                </span>
              )}
            </div>

            <h1 className="font-display text-3xl font-bold leading-tight text-forest sm:text-4xl">
              {event.name}
            </h1>
            {humanizeHost(event.source_name, event.name) && (
              <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-earth">
                {humanizeHost(event.source_name, event.name)}
              </p>
            )}

            {/* facts */}
            <dl className="mt-5 grid gap-3 text-sm">
              <div className="flex items-start gap-3">
                <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-light">
                  When
                </dt>
                <dd className="font-medium text-forest">{dateStr}</dd>
              </div>
              {timeRange && (
                <div className="flex items-start gap-3">
                  <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-light">
                    Time
                  </dt>
                  <dd className="font-medium text-forest">{timeRange}</dd>
                </div>
              )}
              <div className="flex items-start gap-3">
                <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-light">
                  Where
                </dt>
                <dd className="font-medium text-forest">
                  {event.venue_name}
                  <span className="block text-xs font-normal text-stone">
                    {displayAddress || `${event.town}, CA`}
                  </span>
                </dd>
              </div>
              {event.price && (
                <div className="flex items-start gap-3">
                  <dt className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-light">
                    Price
                  </dt>
                  <dd className="font-medium text-forest">{event.price}</dd>
                </div>
              )}
            </dl>

            {/* Actions. Share is the primary door (the shared link is the growth loop);
                download, calendar, and directions are secondary. */}
            <div className="mt-6 flex flex-wrap gap-2.5">
              <ShareButton
                url={`${SITE_URL}/events/${slug}`}
                title={event.name}
                text={`${event.name} at ${event.venue_name} in ${event.town}`}
                variant="primary"
              />
              <a
                href={downloadHref}
                download
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-light/40 bg-white px-4 py-2 text-sm font-medium text-forest transition-colors hover:border-pine/30 hover:text-pine"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                </svg>
                Download poster
              </a>
              <a
                href={calendarUrl(event)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-light/40 bg-white px-4 py-2 text-sm font-medium text-forest transition-colors hover:border-pine/30 hover:text-pine"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Add to calendar
              </a>
              <a
                href={directionsHref}
                target="_blank"
                rel="noopener noreferrer"
                data-otrack="directions"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-light/40 bg-white px-4 py-2 text-sm font-medium text-forest transition-colors hover:border-pine/30 hover:text-pine"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.5-7-11a7 7 0 0114 0c0 4.5-7 11-7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                Directions
              </a>
            </div>

            {link.kind !== "none" && link.href && (
              <p className="mt-4 text-sm text-stone">
                More info:{" "}
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-otrack="more_info"
                  className="font-medium text-pine underline underline-offset-2 hover:text-forest"
                >
                  {link.label}
                </a>
              </p>
            )}

            <p className="mt-4 text-sm text-stone">
              See something off?{" "}
              <Link
                href={`/events/${slug}/report`}
                className="font-medium text-pine underline underline-offset-2 hover:text-forest"
              >
                Suggest a fix
              </Link>
            </p>
          </div>
        </div>

        {/* About */}
        {event.description && (
          <section className="mt-10">
            <h2 className="font-display mb-2 text-lg font-semibold text-forest">
              About This Event
            </h2>
            <p className="max-w-3xl leading-relaxed text-stone">
              <LinkifiedText text={event.description} />
            </p>
          </section>
        )}

        {/* Performers */}
        {event.artists && event.artists.length > 0 && (
          <section className="mt-8">
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

        {/* Where */}
        <section className="mt-8">
          <h2 className="font-display mb-3 text-lg font-semibold text-forest">
            Where
          </h2>
          <EventMap
            town={event.town}
            venueName={event.venue_name}
            address={event.address}
            geocodeQuery={geocodeQuery}
            mapLat={mapLat}
            mapLng={mapLng}
            mapZoom={mapZoom}
          />
        </section>

        {venue && <VenueInfo venue={venue} />}
      </article>

      <div className="mt-10 border-t border-stone-light/30 pt-6">
        <Link href="/" className="text-sm font-medium text-pine hover:underline">
          &larr; Back to all events
        </Link>
      </div>
    </main>
  );
}
