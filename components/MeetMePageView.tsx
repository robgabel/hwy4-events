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
import { isMeetMeEvent, type MeetMeGuide } from "@/lib/meet-me-pages";
import { marketGuideForTown } from "@/lib/market-pages";

// The named-concert sibling of MarketPageView (same editorial + Q&A + live
// calendar spine). The list is every upcoming public date of THIS concert
// name, pulled from the shared cached feed, so the page is honestly empty
// until a new listing lands. See lib/meet-me-pages.ts for why this page
// exists (HWY-38: the 2026 dated URL cancelled and 404s).

export default async function MeetMePageView({ guide }: { guide: MeetMeGuide }) {
  const today = pacificToday().iso;
  const [upcoming, forecastsByTown] = await Promise.all([
    getUpcomingEvents(),
    getForecastsByTown(),
  ]);

  const dates = upcoming
    .filter((e) => e.visibility === "public" && isMeetMeEvent(guide, e))
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const next: Hwy4Event | undefined = dates[0];
  const market = marketGuideForTown(guide.townSlug);

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
          <p className="speakable text-center text-lg leading-relaxed text-stone sm:text-left">
            {guide.lead}
          </p>
        </div>
      </div>

      <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border border-earth/30 bg-warm-white px-5 py-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">
            2026 listing
          </dt>
          <dd className="text-stone">
            {guide.listedDate} at {guide.listedTime}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">
            Status
          </dt>
          <dd className="font-semibold text-forest">Cancelled</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">
            Listed address
          </dt>
          <dd className="text-stone">{guide.listedAddress}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-light">
            Next confirmed date
          </dt>
          <dd className="font-semibold text-forest">
            {next ? format(parseISO(next.date), "EEEE, MMMM d, yyyy") : "Unknown"}
          </dd>
        </div>
      </dl>

      <div className="speakable mb-8 space-y-3">
        {guide.editorial.map((p) => (
          <p key={p.slice(0, 24)} className="leading-relaxed text-stone">
            {p}
          </p>
        ))}
      </div>

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
        {market && (
          <Link
            href={market.path}
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            {market.label}
          </Link>
        )}
        <Link
          href="/things-to-do"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          Things to do
        </Link>
        <a
          href={guide.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          Organizer site
        </a>
      </nav>

      <section className="mb-10">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          Upcoming Meet Me in Murphys dates
        </h2>
        {dates.length > 0 ? (
          <SimpleEventList
            events={dates}
            newsletterSource={`meet_me_${guide.key}`}
            forecastsByTown={forecastsByTown}
          />
        ) : (
          <p className="rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-stone">
            No upcoming Meet Me in Murphys dates are on the calendar. The 2026
            concert listing for September 5 was cancelled. If organizers announce
            another date, it will show here. In the meantime, the{" "}
            <Link
              href={`/towns/${guide.townSlug}`}
              className="font-medium text-pine hover:underline"
            >
              {guide.town} page
            </Link>{" "}
            has everything else coming up in town.
          </p>
        )}
      </section>

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
          source={`meet_me_${guide.key}`}
          heading="Want a heads-up if a new date lands?"
          description="One email Thursday morning with what's coming up across the corridor, Angels Camp to Bear Valley. No spam, no ads."
        />
      </section>
    </main>
  );
}
