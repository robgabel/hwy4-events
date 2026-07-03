import Link from "next/link";
import Image from "next/image";
import { format, parseISO } from "date-fns";

import { SITE_URL } from "@/lib/constants";
import { Hwy4Event } from "@/lib/types";
import { getEventsInRange } from "@/lib/events-data";
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
import { pacificToday } from "@/lib/date-windows";
import { addDaysIso } from "@/lib/picks";
import { INTENT_CONFIG, type IntentKey } from "@/lib/intent-pages";

// The intent-page sibling of TemporalEventsView: same live-calendar spine
// (shared cached fetch, SimpleEventList, JSON-LD, town cross-links), but the
// window is intent-shaped (a filter over the corridor set) and the page opens
// with fixed editorial copy + a short Q&A written for the queries visitors
// actually type (BUSINESS-PLAN §8: editorial over programmatic).

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

export default async function IntentPageView({
  intentKey,
}: {
  intentKey: IntentKey;
}) {
  const cfg = INTENT_CONFIG[intentKey];
  const today = pacificToday().iso;
  const end = addDaysIso(today, cfg.windowDays);
  const [inRange, forecastsByTown] = await Promise.all([
    getEventsInRange(today, end),
    getForecastsByTown(),
  ]);
  const events = inRange.filter(cfg.filter);
  const grouped = groupByDate(events);
  const townLinks = publishedTownLinks();

  const siblings = Object.values(INTENT_CONFIG).filter(
    (c) => c.key !== intentKey
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={buildBreadcrumbs([
          { name: "Hwy 4 Events", url: SITE_URL },
          { name: cfg.label, url: `${SITE_URL}${cfg.path}` },
        ])}
      />
      <JsonLd
        data={buildWebPage({
          url: `${SITE_URL}${cfg.path}`,
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

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">{cfg.label}</li>
        </ol>
      </nav>

      {/* Hero */}
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
        </div>
      </div>

      {/* Editorial intro */}
      <div className="mb-6 space-y-3">
        {cfg.editorial.map((p) => (
          <p key={p.slice(0, 24)} className="leading-relaxed text-stone">
            {p}
          </p>
        ))}
      </div>

      {/* Cross-links to the other intent + temporal views */}
      <nav aria-label="More ways to browse" className="mb-8 flex flex-wrap gap-2">
        <Link
          href="/this-weekend"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          This Weekend
        </Link>
        {siblings.map((s) => (
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

      {/* Events grouped by day */}
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
                    newsletterSource={`intent_${cfg.key}`}
                    forecastsByTown={forecastsByTown}
                  />
                </section>
              );
            });
          })()}
        </div>
      ) : (
        <p className="mb-10 rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-stone">
          Nothing in this lane on the calendar right now. Check the{" "}
          <Link href="/" className="font-medium text-pine hover:underline">
            full corridor list
          </Link>
          , or check back. New events get added daily.
        </p>
      )}

      {/* Q&A — written to resolve the searches that land here */}
      <section className="mb-10">
        <h2 className="font-display mb-3 text-lg font-semibold text-forest">
          Good to know
        </h2>
        <div className="space-y-4">
          {cfg.qa.map((item) => (
            <div key={item.q}>
              <h3 className="font-semibold text-forest">{item.q}</h3>
              <p className="mt-1 leading-relaxed text-stone">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section className="mb-10">
        <NewsletterSignup
          source={`intent_${cfg.key}`}
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
