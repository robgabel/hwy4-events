import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

import { SITE_URL } from "@/lib/constants";
import type { Hwy4Venue } from "@/lib/types";
import { TOWN_INFO } from "@/lib/towns";
import { townSlug } from "@/lib/slugs";
import { getTownContent } from "@/app/towns/town-content";
import { getUpcomingEvents } from "@/lib/events-data";
import { venueMetaTitle, venueMetaDescription } from "@/lib/venue-pages";
import {
  JsonLd,
  buildBreadcrumbs,
  buildItemList,
  buildWebPage,
} from "@/lib/schema";
import SimpleEventList from "@/components/SimpleEventList";
import NewsletterSignup from "@/components/NewsletterSignup";
import VenueInfo from "@/components/VenueInfo";
import { getForecast, type TownForecasts } from "@/lib/weather";
import { pacificToday } from "@/lib/date-windows";

// Venue hub pages (HWY-9, generalized from the Brice Station ticket): one
// URL per registry venue (/venues/<venue_key>) that answers "what's coming up
// at <venue>" — the query shape GSC shows landing on dated event-instance
// pages ("brice station concerts 2026", "ironstone concerts"), which expire
// with each instance. The hub is the durable target: venue name + local-voice
// blurb + Google facts (reusing VenueInfo) + a live upcoming-event list from
// the shared cached feed. Every registry venue renders; only venues with
// enough upcoming events are advertised in sitemap-core (lib/venue-pages.ts).

export const revalidate = 3600;

type PageProps = { params: Promise<{ slug: string }> };

const VENUE_COLUMNS =
  "venue_key, canonical, town, address, blurb, place_id, rating, user_ratings_total, phone, website, maps_url, hours, places_attributes, places_synced_at";

const findVenue = cache(async (venueKey: string): Promise<Hwy4Venue | null> => {
  // venue_key is a registry slug (lowercase kebab); reject anything else
  // before it reaches the query.
  if (!/^[a-z0-9-]{1,80}$/.test(venueKey)) return null;
  const { supabase } = await import("@/lib/supabase");
  const { data } = await supabase
    .from("hwy4_venues")
    .select(VENUE_COLUMNS)
    .eq("venue_key", venueKey)
    .maybeSingle();
  return (data as unknown as Hwy4Venue) ?? null;
});

async function venueEvents(venueKey: string) {
  const all = await getUpcomingEvents();
  return all.filter(
    (e) => e.venue_key === venueKey && e.visibility === "public"
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const venue = await findVenue(slug);
  if (!venue) return { title: "Venue not found" };

  const events = await venueEvents(slug);
  const year = Number(pacificToday().iso.slice(0, 4));
  const title = venueMetaTitle(venue, events, year);
  const description = venueMetaDescription(venue, events);

  return {
    title,
    description,
    alternates: { canonical: `/venues/${slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}/venues/${slug}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function VenuePage({ params }: PageProps) {
  const { slug } = await params;
  const venue = await findVenue(slug);
  if (!venue) notFound();

  const events = await venueEvents(slug);
  const town = TOWN_INFO[venue.town];
  const townPageSlug = townSlug(venue.town);
  const hasTownPage = Boolean(getTownContent(townPageSlug));
  const townForecast = town ? await getForecast(town.lat, town.lng) : null;
  const forecastsByTown: TownForecasts | null = townForecast
    ? { [venue.town]: townForecast }
    : null;

  const crumbs = [
    { name: "Hwy 4 Events", url: SITE_URL },
    ...(hasTownPage
      ? [{ name: venue.town, url: `${SITE_URL}/towns/${townPageSlug}` }]
      : []),
    { name: venue.canonical, url: `${SITE_URL}/venues/${slug}` },
  ];

  const year = Number(pacificToday().iso.slice(0, 4));

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={buildBreadcrumbs(crumbs)} />
      <JsonLd
        data={buildWebPage({
          url: `${SITE_URL}/venues/${slug}`,
          name: venueMetaTitle(venue, events, year),
          description: venueMetaDescription(venue, events),
          dateModified: pacificToday().iso,
        })}
      />
      {events.length > 0 && (
        <JsonLd
          data={buildItemList(events, {
            name: `Upcoming events at ${venue.canonical}`,
            description: `Upcoming events at ${venue.canonical} in ${venue.town}, CA, from the Highway 4 corridor calendar.`,
            limit: 25,
          })}
        />
      )}

      {/* Breadcrumb (visible) */}
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          {hasTownPage && (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href={`/towns/${townPageSlug}`}
                  className="text-pine hover:underline"
                >
                  {venue.town}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">{venue.canonical}</li>
        </ol>
      </nav>

      {/* Hero */}
      <div className="mb-8 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <Image
          src="/millie-happy.svg"
          alt="Millie the sheepadoodle"
          width={88}
          height={88}
          className="shrink-0"
          priority
        />
        <div>
          <h1 className="font-display mb-2 text-center text-3xl font-bold text-forest sm:text-left">
            {venue.canonical}
          </h1>
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            Upcoming events in {venue.town}, from the live Highway 4 corridor
            calendar.
          </p>
          {venue.address && (
            <p className="mt-2 text-center text-sm text-stone-light sm:text-left">
              {venue.address}
            </p>
          )}
        </div>
      </div>

      {/* Blurb + Google facts strip + practical badges (shared component). */}
      <VenueInfo venue={venue} />

      {/* Upcoming events */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          What&apos;s coming up at {venue.canonical}
        </h2>
        {events.length > 0 ? (
          <SimpleEventList
            events={events.slice(0, 25)}
            newsletterAfterIndex={4}
            newsletterSource={`venue_${slug}`}
            forecastsByTown={forecastsByTown}
          />
        ) : (
          <p className="rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-sm text-stone">
            Nothing on the calendar here right now. The corridor list refreshes
            daily; see{" "}
            <Link href="/" className="font-medium text-pine hover:underline">
              everything upcoming on the 4
            </Link>
            {hasTownPage && (
              <>
                {" "}
                or{" "}
                <Link
                  href={`/towns/${townPageSlug}`}
                  className="font-medium text-pine hover:underline"
                >
                  what&apos;s happening in {venue.town}
                </Link>
              </>
            )}
            .
          </p>
        )}
      </section>

      {/* Newsletter */}
      <section className="mb-10">
        <NewsletterSignup
          source={`venue_${slug}`}
          heading="Want a Thursday heads-up?"
          description={`One email Thursday morning with what's coming up in ${venue.town} and the rest of the corridor. No spam, no ads.`}
        />
      </section>

      {/* Internal links out */}
      <nav aria-label="More events" className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/this-weekend"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          This Weekend
        </Link>
        {hasTownPage && (
          <Link
            href={`/towns/${townPageSlug}`}
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            {venue.town}
          </Link>
        )}
        <Link
          href="/"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          Full calendar
        </Link>
      </nav>
    </main>
  );
}
