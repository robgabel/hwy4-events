import Link from "next/link";
import Image from "next/image";
import { format, parseISO } from "date-fns";

import { SITE_URL } from "@/lib/constants";
import { Hwy4Event } from "@/lib/types";
import { getUpcomingEvents } from "@/lib/events-data";
import {
  JsonLd,
  buildBreadcrumbs,
  buildFaqPage,
  buildItemList,
  buildWebPage,
} from "@/lib/schema";
import SimpleEventList from "@/components/SimpleEventList";
import NewsletterSignup from "@/components/NewsletterSignup";
import { getForecastsByTown } from "@/lib/weather";
import { pacificToday } from "@/lib/date-windows";
import {
  MARKET_GUIDES,
  isMarketEvent,
  type MarketGuide,
} from "@/lib/market-pages";

// The recurring-market sibling of HolidayPageView (same editorial + Q&A + live
// calendar spine). The difference: the list is every upcoming date of ONE
// market, pulled from the shared cached feed, so the page needs no annual
// rebuild and is honestly empty between seasons rather than asserting dates
// nobody has confirmed. See lib/market-pages.ts for why this page exists at
// all (HWY-31: a dated event-instance URL cannot accumulate search equity).

export default async function MarketPageView({ guide }: { guide: MarketGuide }) {
  const today = pacificToday().iso;
  const [upcoming, forecastsByTown] = await Promise.all([
    getUpcomingEvents(),
    getForecastsByTown(),
  ]);

  const dates = upcoming
    .filter((e) => e.visibility === "public" && isMarketEvent(guide, e))
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const next: Hwy4Event | undefined = dates[0];
  const sibling = MARKET_GUIDES.find((g) => g.key !== guide.key);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={buildBreadcrumbs([
          { name: "Hwy 4 Events", url: SITE_URL },
          { name: guide.label, url: `${SITE_URL}${guide.path}` },
        ])}
      />
      <JsonLd
        data={buildWebPage({
          url: `${SITE_URL}${guide.path}`,
          name: guide.metaTitle,
          description: guide.metaDescription,
          dateModified: new Date().toISOString().split("T")[0],
        })}
      />
      <JsonLd
        data={buildFaqPage(
          guide.qa.map((item) => ({ question: item.q, answer: item.a }))
        )}
      />
      {dates.length > 0 && (
        <JsonLd
          data={buildItemList(dates, {
            name: guide.metaTitle,
            description: guide.metaDescription,
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
          <li className="text-stone-light">{guide.label}</li>
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
            {guide.h1}
          </h1>
          {/* The lead is the answer: day, hours, park, street address, season.
              Kept as one plain sentence so a search result or an answer engine
              can lift it whole. */}
          <p className="speakable text-center text-lg leading-relaxed text-stone sm:text-left">
            {guide.lead}
          </p>
        </div>
      </div>

      {/* At-a-glance facts, the scan-level version of the lead. */}
      <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-earth/30 bg-warm-white px-5 py-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">Day</dt>
          <dd className="text-stone">{guide.day}s</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">Hours</dt>
          <dd className="text-stone">{guide.hours}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">Where</dt>
          <dd className="text-stone">
            {guide.venue}, {guide.address}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">Season</dt>
          <dd className="text-stone">Runs {guide.season}</dd>
        </div>
        {next && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">
              Next market day
            </dt>
            <dd className="font-semibold text-forest">
              {format(parseISO(next.date), "EEEE, MMMM d")}
            </dd>
          </div>
        )}
      </dl>

      {/* Editorial */}
      <div className="speakable mb-8 space-y-3">
        {guide.editorial.map((p) => (
          <p key={p.slice(0, 24)} className="leading-relaxed text-stone">
            {p}
          </p>
        ))}
      </div>

      {/* Cross-links */}
      <nav aria-label="More ways to browse" className="mb-8 flex flex-wrap gap-2">
        <Link
          href={`/towns/${guide.townSlug}`}
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          More in {guide.town}
        </Link>
        <Link
          href="/this-weekend"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          This Weekend
        </Link>
        {sibling && (
          <Link
            href={sibling.path}
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            {sibling.label}
          </Link>
        )}
        <Link
          href="/free"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          Free things to do
        </Link>
      </nav>

      {/* The season's dates: live from the DB, honestly empty off-season. This
          section is what makes the page evergreen without a yearly rebuild. */}
      <section className="mb-10">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          Remaining {guide.day} dates this season
        </h2>
        {dates.length > 0 ? (
          <SimpleEventList
            events={dates}
            newsletterSource={`market_${guide.key}`}
            forecastsByTown={forecastsByTown}
          />
        ) : (
          <p className="rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-stone">
            The season is over for now, so there are no dates on the calendar yet.
            It normally runs {guide.season}, and next season&apos;s {guide.day}s
            show up here as soon as they are confirmed. In the meantime, the{" "}
            <Link
              href={`/towns/${guide.townSlug}`}
              className="font-medium text-pine hover:underline"
            >
              {guide.town} page
            </Link>{" "}
            has everything coming up sooner.
          </p>
        )}
      </section>

      {/* Q&A — written to resolve the searches that land here */}
      <section className="mb-10">
        <h2 className="font-display mb-3 text-lg font-semibold text-forest">
          Good to know
        </h2>
        <div className="space-y-4">
          {guide.qa.map((item) => (
            <div key={item.q}>
              <h3 className="font-semibold text-forest">{item.q}</h3>
              <p className="mt-1 leading-relaxed text-stone">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4">
        <NewsletterSignup
          source={`market_${guide.key}`}
          heading="Want the week ahead in your inbox?"
          description="One email Thursday morning with what's coming up across the corridor, Angels Camp to Bear Valley. No spam, no ads."
        />
      </section>
    </main>
  );
}
