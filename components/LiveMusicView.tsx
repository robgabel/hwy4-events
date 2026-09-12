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
import { getPublishedTownSlugs } from "@/app/towns/town-content";
import { nowPacificMinutes } from "@/lib/event-time";
import { addDays, pacificToday, thisWeekendRange } from "@/lib/date-windows";
import { INTENT_CONFIG } from "@/lib/intent-pages";
import {
  LIVE_MUSIC_HORIZON_DAYS,
  LIVE_MUSIC_LENSES,
  LIVE_MUSIC_LENS_ORDER,
  LIVE_MUSIC_PAGE,
  LIVE_MUSIC_PATH,
  liveMusicHref,
  liveMusicWindow,
  selectLiveMusic,
  type LiveMusicLens,
} from "@/lib/live-music";

// IntentPageView sibling for /live-music: same cached feed + SimpleEventList
// + JSON-LD spine, plus Tonight / This weekend / Upcoming lenses.

function groupByDate(events: Hwy4Event[]): [string, Hwy4Event[]][] {
  const map = new Map<string, Hwy4Event[]>();
  for (const e of events) {
    const arr = map.get(e.date) ?? [];
    arr.push(e);
    map.set(e.date, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function publishedTownLinks() {
  const published = new Set(getPublishedTownSlugs());
  return CORRIDOR_TOWNS.filter((t) => published.has(townSlug(t.name))).map(
    (t) => ({ name: t.name, slug: townSlug(t.name) })
  );
}

export default async function LiveMusicView({
  lens,
}: {
  lens: LiveMusicLens;
}) {
  const page = LIVE_MUSIC_PAGE;
  const cfg = LIVE_MUSIC_LENSES[lens];
  const today = pacificToday();
  const weekend = thisWeekendRange();
  const window = liveMusicWindow(lens, today);
  const fetchEnd = addDays(today.iso, LIVE_MUSIC_HORIZON_DAYS);
  // Fetch the widest hub window once (upcoming), then lens in memory so
  // tonight/weekend share the same cached getUpcomingEvents scan.
  const [inRange, forecastsByTown, artists] = await Promise.all([
    getEventsInRange(today.iso, fetchEnd),
    getForecastsByTown(),
    getPublishedArtists(),
  ]);
  const artistGenres = artistGenreMap(artists);
  const events = selectLiveMusic(inRange, lens, {
    todayIso: today.iso,
    nowMinutes: nowPacificMinutes(),
    weekend,
    horizonEnd: fetchEnd,
  });
  const grouped = groupByDate(events);
  const townLinks = publishedTownLinks();

  const rangeLabel =
    window.start === window.end
      ? format(parseISO(window.start), "EEEE, MMMM d")
      : `${format(parseISO(window.start), "EEEE, MMMM d")} through ${format(
          parseISO(window.end),
          "EEEE, MMMM d"
        )}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={buildBreadcrumbs([
          { name: "Hwy 4 Events", url: SITE_URL },
          { name: page.label, url: `${SITE_URL}${LIVE_MUSIC_PATH}` },
        ])}
      />
      <JsonLd
        data={buildWebPage({
          url: `${SITE_URL}${LIVE_MUSIC_PATH}`,
          name: cfg.metaTitle,
          description: cfg.metaDescription,
          dateModified: new Date().toISOString().split("T")[0],
        })}
      />
      {events.length > 0 && (
        <JsonLd
          data={buildItemList(events, {
            name: cfg.metaTitle,
            description: cfg.metaDescription,
            limit: 100,
          })}
        />
      )}

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">{page.label}</li>
        </ol>
      </nav>

      <div className="mb-6 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
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
            {cfg.h1}
          </h1>
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            {cfg.lead}
          </p>
          <p className="mt-2 text-center text-xs uppercase tracking-wide text-stone-light sm:text-left">
            {rangeLabel}
          </p>
        </div>
      </div>

      <div className="mb-6 space-y-3">
        {page.editorial.map((p) => (
          <p key={p.slice(0, 24)} className="leading-relaxed text-stone">
            {p}
          </p>
        ))}
      </div>

      <nav
        aria-label="When"
        className="mb-6 inline-flex flex-wrap rounded-full border border-stone-light/40 bg-white text-sm font-semibold"
      >
        {LIVE_MUSIC_LENS_ORDER.map((key, i) => {
          const item = LIVE_MUSIC_LENSES[key];
          const active = key === lens;
          return (
            <Link
              key={key}
              href={liveMusicHref(key)}
              aria-current={active ? "page" : undefined}
              className={`px-3 py-1.5 transition-colors ${
                i > 0 ? "border-l border-stone-light/40" : ""
              } ${
                active
                  ? "bg-pine text-white"
                  : "text-forest hover:text-pine"
              } ${i === 0 ? "rounded-l-full" : ""} ${
                i === LIVE_MUSIC_LENS_ORDER.length - 1 ? "rounded-r-full" : ""
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <nav aria-label="More ways to browse" className="mb-8 flex flex-wrap gap-2">
        <Link
          href="/this-weekend"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          This Weekend
        </Link>
        {Object.values(INTENT_CONFIG).map((s) => (
          <Link
            key={s.key}
            href={s.path}
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            {s.label}
          </Link>
        ))}
        <Link
          href="/"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          Full calendar
        </Link>
      </nav>

      {grouped.length > 0 ? (
        <div className="mb-10 space-y-8">
          {(() => {
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
                    newsletterSource={`live_music_${lens}`}
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
          {cfg.empty}{" "}
          {lens === "tonight" ? (
            <>
              Check{" "}
              <Link
                href={liveMusicHref("weekend")}
                className="font-medium text-pine hover:underline"
              >
                this weekend
              </Link>
              {" or "}
              <Link
                href={liveMusicHref("upcoming")}
                className="font-medium text-pine hover:underline"
              >
                upcoming shows
              </Link>
              .
            </>
          ) : (
            <>
              Check the{" "}
              <Link href="/" className="font-medium text-pine hover:underline">
                full corridor list
              </Link>
              , or check back. New events get added daily.
            </>
          )}
        </p>
      )}

      <section className="mb-10">
        <h2 className="font-display mb-3 text-lg font-semibold text-forest">
          Good to know
        </h2>
        <div className="space-y-4">
          {page.qa.map((item) => (
            <div key={item.q}>
              <h3 className="font-semibold text-forest">{item.q}</h3>
              <p className="mt-1 leading-relaxed text-stone">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <NewsletterSignup
          source={`live_music_${lens}`}
          heading="Want a Thursday heads-up?"
          description="One email Thursday morning with what's coming up across the corridor, Angels Camp to Bear Valley. No spam, no ads."
        />
      </section>

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
