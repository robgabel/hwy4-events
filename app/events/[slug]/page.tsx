import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Hwy4Event, CATEGORY_LABELS } from "@/lib/types";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { format, parseISO } from "date-fns";
import Link from "next/link";

export const revalidate = 3600;

async function getAllEvents(): Promise<Hwy4Event[]> {
  const { supabase } = await import("@/lib/supabase");
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, event_url, source_url, source_name, visibility, org_slug, importance"
    )
    .gte("date", today)
    .eq("is_past", false)
    .neq("status", "cancelled")
    .order("date", { ascending: true });

  return (data as Hwy4Event[]) || [];
}

async function findEventBySlug(slug: string): Promise<Hwy4Event | null> {
  const events = await getAllEvents();
  return (
    events.find(
      (e) => generateEventSlug(e.name, e.date, e.town) === slug
    ) || null
  );
}

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
        ...(event.address && { streetAddress: event.address }),
        addressLocality: event.town,
        addressRegion: "CA",
        addressCountry: "US",
      },
    },
    ...(event.price && {
      offers: {
        "@type": "Offer",
        price: event.price === "Free" ? "0" : event.price,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: event.event_url || `${SITE_URL}/events/${slug}`,
      },
    }),
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
          <h1 className="text-3xl font-bold text-forest">{event.name}</h1>
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
              {event.address && (
                <span className="block text-xs text-stone">
                  {event.address}
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

        {event.description && (
          <section className="mb-6">
            <h2 className="mb-2 text-lg font-semibold text-forest">
              About This Event
            </h2>
            <p className="leading-relaxed text-stone">{event.description}</p>
          </section>
        )}

        {event.artists && event.artists.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-lg font-semibold text-forest">
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

        {event.event_url && (
          <div className="mb-6">
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
          </div>
        )}
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
