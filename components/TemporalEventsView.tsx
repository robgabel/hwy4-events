import Link from "next/link";
import Image from "next/image";
import { format, parseISO } from "date-fns";

import { SITE_URL } from "@/lib/constants";
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
import { pageDateModified } from "@/lib/date-modified";
import LiveEventDays from "@/components/LiveEventDays";
import NewsletterSignup from "@/components/NewsletterSignup";
import { getForecastsByTown } from "@/lib/weather";
import { getPublishedTownSlugs, getTownContent } from "@/app/towns/town-content";
import {
  TEMPORAL_CONFIG,
  nextWeekendPath,
  nextWeekendRange,
  pacificNow,
  type WindowKey,
} from "@/lib/date-windows";
import { stayHref, type StayRange } from "@/lib/stay-range";
import CopyPageLink from "@/components/CopyPageLink";
import { filterListableEvents } from "@/lib/list-visibility";
import { filterListableNow, nowPacificMinutes } from "@/lib/event-time";

// Event fetching moved to lib/events-data.ts (getEventsInRange) — an in-memory
// filter over the site-wide cached upcoming-events set, so this view adds no
// database scan of its own.

function spanLabel(range: { start: string; end: string }): string {
  if (range.start === range.end) return format(parseISO(range.start), "EEEE, MMMM d");
  return `${format(parseISO(range.start), "EEEE, MMMM d")} through ${format(
    parseISO(range.end),
    "EEEE, MMMM d"
  )}`;
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
    ? "Every event along the Highway 4 corridor for these dates, from Angels Camp to Bear Valley."
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
    ? "Events along the Highway 4 corridor for this stay."
    : cfg.metaDescription;
  const [inRange, forecastsByTown, artists] = await Promise.all([
    getEventsInRange(range.start, range.end),
    getForecastsByTown(),
    getPublishedArtists(),
  ]);
  // Public feed. No Clubs toggle on temporal or stay-range pages, so
  // members-only rows stay out (same gate as the homepage with nothing checked).
  // Ended rows drop here so JSON-LD matches the HTML generated this hour.
  // LiveEventDays re-checks the clock after hydration, because this page is
  // cached for an hour and a Sunday visitor should not see a finished show.
  const listed = filterListableEvents(inRange);
  const serverNow = pacificNow();
  const events = filterListableNow(listed, nowPacificMinutes());
  const artistGenres = artistGenreMap(artists);
  const townLinks = publishedTownLinks();
  const handoff =
    windowKey === "weekend" && !isStay
      ? {
          href: nextWeekendPath(range),
          dateLabel: spanLabel(nextWeekendRange(range)),
          pageRange: range,
          serverNow,
          listedCount: listed.length,
        }
      : null;

  const rangeLabel = spanLabel(range);

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
          dateModified: pageDateModified(events),
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

      {/* Events grouped by day. Ended rows drop again on the client so the
          hourly cache cannot keep a finished show in front of a visitor. */}
      <LiveEventDays
        events={events}
        newsletterSource={`temporal_${windowKey}`}
        forecastsByTown={forecastsByTown}
        artistGenres={artistGenres}
        handoff={handoff}
        empty={
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
        }
      />

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
