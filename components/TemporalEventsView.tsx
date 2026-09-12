import Link from "next/link";
import Image from "next/image";
import { format, parseISO } from "date-fns";

import { SITE_URL } from "@/lib/constants";
import { Hwy4Event } from "@/lib/types";
import { getEventsInRange } from "@/lib/events-data";
import { getPublishedArtists } from "@/lib/artists-data";
import { artistGenreMap } from "@/lib/artists";
import { townSlug } from "@/lib/slugs";
import { CORRIDOR_TOWNS } from "@/lib/towns";
import {
  JsonLd,
  buildBreadcrumbs,
  buildItemList,
  buildWebPage,
} from "@/lib/schema";
import SimpleEventList from "@/components/SimpleEventList";
import NewsletterSignup from "@/components/NewsletterSignup";
import { getForecastsByTown } from "@/lib/weather";
import { getPublishedTownSlugs, getTownContent } from "@/app/towns/town-content";
import { TEMPORAL_CONFIG, type WindowKey } from "@/lib/date-windows";
import { stayHref, type StayRange } from "@/lib/stay-range";
import CopyPageLink from "@/components/CopyPageLink";

// Event fetching moved to lib/events-data.ts (getEventsInRange) — an in-memory
// filter over the site-wide cached upcoming-events set, so this view adds no
// database scan of its own.

function groupByDate(events: Hwy4Event[]): [string, Hwy4Event[]][] {
  const map = new Map<string, Hwy4Event[]>();
  for (const e of events) {
    const arr = map.get(e.date) ?? [];
    arr.push(e);
    map.set(e.date, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Published town pages, ordered west-to-east by elevation, for cross-links. */
function publishedTownLinks() {
  const published = new Set(getPublishedTownSlugs());
  return CORRIDOR_TOWNS.filter((t) => published.has(townSlug(t.name))).map(
    (t) => ({ name: t.name, slug: townSlug(t.name) })
  );
}

export default async function TemporalEventsView({
  windowKey,
  stay = null,
}: {
  windowKey: WindowKey;
  /** Valid guest-stay overlay (HWY-40). Null = the page's usual window. */
  stay?: StayRange | null;
}) {
  const cfg = TEMPORAL_CONFIG[windowKey];
  const range = stay ?? cfg.getRange();
  const isStay = stay != null;
  const h1 = isStay ? "What's on during your stay on Hwy 4" : cfg.h1;
  const lead = isStay
    ? "Every public event along the Highway 4 corridor for these dates, from Angels Camp to Bear Valley."
    : cfg.lead;
  const pagePath = isStay && stay ? stayHref(stay) : cfg.path;
  const pageUrl = `${SITE_URL}${pagePath}`;
  const copyUrl = (() => {
    try {
      const u = new URL(pageUrl);
      u.searchParams.set("src", "share");
      return u.toString();
    } catch {
      return pageUrl;
    }
  })();
  const jsonName = isStay ? `What's on Hwy 4 during your stay` : cfg.metaTitle;
  const jsonDescription = isStay
    ? "Public events along the Highway 4 corridor for this stay."
    : cfg.metaDescription;
  const [events, forecastsByTown, artists] = await Promise.all([
    getEventsInRange(range.start, range.end),
    getForecastsByTown(),
    getPublishedArtists(),
  ]);
  const artistGenres = artistGenreMap(artists);
  const grouped = groupByDate(events);
  const townLinks = publishedTownLinks();

  const rangeLabel =
    range.start === range.end
      ? format(parseISO(range.start), "EEEE, MMMM d")
      : `${format(parseISO(range.start), "EEEE, MMMM d")} through ${format(
          parseISO(range.end),
          "EEEE, MMMM d"
        )}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={buildBreadcrumbs([
          { name: "Hwy 4 Events", url: SITE_URL },
          { name: isStay ? "Your stay" : cfg.label, url: pageUrl },
        ])}
      />
      <JsonLd
        data={buildWebPage({
          url: pageUrl,
          name: jsonName,
          description: jsonDescription,
          dateModified: new Date().toISOString().split("T")[0],
        })}
      />
      {events.length > 0 && (
        <JsonLd
          data={buildItemList(events, {
            name: jsonName,
            description: jsonDescription,
            limit: 100,
            artists,
          })}
        />
      )}

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">{isStay ? "Your stay" : cfg.label}</li>
        </ol>
      </nav>

      {/* Hero */}
      <div className="mb-8 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <Image
          src="/millie-happy.svg"
          alt="Millie the sheepadoodle, ready for the weekend"
          width={88}
          height={88}
          className="shrink-0"
          priority
        />
        <div>
          <h1 className="font-display mb-2 text-center text-3xl font-bold text-forest sm:text-left">
            {h1}
          </h1>
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            {lead}
          </p>
          <p className="mt-2 text-center text-xs uppercase tracking-wide text-stone-light sm:text-left">
            {rangeLabel}
          </p>
          {windowKey === "weekend" && (
            <div className="mt-4 flex flex-col items-center gap-2 sm:items-start">
              <CopyPageLink url={copyUrl} />
              <p className="text-center text-xs text-stone-light sm:text-left">
                Paste this into a welcome message. Hosts can pick other dates at{" "}
                <Link href="/hosts" className="text-pine hover:underline">
                  /hosts
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Events grouped by day */}
      {grouped.length > 0 ? (
        <div className="mb-10 space-y-8">
          {(() => {
            // Drop the inline newsletter after the 5th event overall (index 4),
            // matching the homepage/SEO pages. Events are split across day
            // groups, so track a running offset and hand the local index to
            // whichever day group the 5th event lands in.
            let priorCount = 0;
            return grouped.map(([date, dayEvents]) => {
              const localIdx = 4 - priorCount;
              priorCount += dayEvents.length;
              const newsletterAfterIndex =
                localIdx >= 0 && localIdx < dayEvents.length
                  ? localIdx
                  : undefined;
              return (
                <section key={date}>
                  <h2 className="font-display mb-3 border-b border-stone-light/30 pb-1 text-lg font-semibold text-forest">
                    {format(parseISO(date), "EEEE, MMMM d")}
                  </h2>
                  <SimpleEventList
                    events={dayEvents}
                    newsletterAfterIndex={newsletterAfterIndex}
                    newsletterSource={`temporal_${windowKey}`}
                    forecastsByTown={forecastsByTown}
                    artistGenres={artistGenres}
                  />
                </section>
              );
            });
          })()}
        </div>
      ) : (
        <p className="mb-10 rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-stone">
          {isStay
            ? "Nothing on the calendar for these dates yet. The list only shows events already listed, so a quiet stretch is honest."
            : "Nothing on the calendar for this window yet."}{" "}
          Check the{" "}
          <Link href="/" className="font-medium text-pine hover:underline">
            full corridor list
          </Link>
          , or check back. New events get added daily.
        </p>
      )}

      {/* Newsletter */}
      <section className="mb-10">
        <NewsletterSignup
          source={`temporal_${windowKey}`}
          heading="Want a Thursday heads-up?"
          description="One email Thursday morning with what's coming up across the corridor, Angels Camp to Bear Valley. No spam, no ads."
        />
      </section>

      {/* Browse by town */}
      {townLinks.length > 0 && (
        <section className="mb-4">
          <h2 className="font-display mb-3 text-lg font-semibold text-forest">
            Browse by town
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {townLinks.map((t) => (
              <Link
                key={t.slug}
                href={`/towns/${t.slug}`}
                className="rounded-lg border border-stone-light/20 bg-white px-3 py-2 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
              >
                {t.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
