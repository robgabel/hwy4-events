import Link from "next/link";
import Image from "next/image";
import { format, parseISO } from "date-fns";

import { SITE_URL } from "@/lib/constants";
import { Hwy4Event } from "@/lib/types";
import { getEventsInRange } from "@/lib/events-data";
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
  HOLIDAY_GUIDES,
  julyWindow,
  type HolidayGuide,
} from "@/lib/holiday-pages";

// The evergreen-holiday sibling of IntentPageView (same editorial + Q&A +
// live-calendar spine). The difference: the event window is the upcoming July
// holiday week for ONE town, so off-season the list is honestly empty (with a
// check-back line) and each spring it fills itself from the DB with no code
// change. That self-filling section is what makes the page a "placeholder for
// next year" without publishing unconfirmed event rows (PRD-july4-evergreen.md).

function groupByDate(events: Hwy4Event[]): [string, Hwy4Event[]][] {
  const map = new Map<string, Hwy4Event[]>();
  for (const e of events) {
    const arr = map.get(e.date) ?? [];
    arr.push(e);
    map.set(e.date, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export default async function HolidayPageView({ guide }: { guide: HolidayGuide }) {
  const today = pacificToday().iso;
  const win = julyWindow(today);
  // Clamp to today so mid-holiday-week visits don't list already-past days.
  const start = win.start > today ? win.start : today;
  const [inRange, forecastsByTown] = await Promise.all([
    getEventsInRange(start, win.end),
    getForecastsByTown(),
  ]);
  const events = inRange.filter(
    (e) => e.visibility === "public" && e.town === guide.town
  );
  const grouped = groupByDate(events);
  const holidayYear = win.end.slice(0, 4);

  const sibling = HOLIDAY_GUIDES.find((g) => g.key !== guide.key);

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
      {events.length > 0 && (
        <JsonLd
          data={buildItemList(events, {
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
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            {guide.lead}
          </p>
        </div>
      </div>

      {/* Editorial */}
      <div className="speakable mb-6 space-y-3">
        {guide.editorial.map((p) => (
          <p key={p.slice(0, 24)} className="leading-relaxed text-stone">
            {p}
          </p>
        ))}
      </div>

      {/* Next year (the evergreen placeholder block) */}
      <section className="mb-8 rounded-xl border border-earth/30 bg-warm-white px-5 py-4">
        <h2 className="font-display mb-1 font-bold text-forest">
          Looking ahead to next year
        </h2>
        <p className="leading-relaxed text-stone">{guide.nextYear}</p>
      </section>

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
          href="/things-to-do"
          className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
        >
          Things to do
        </Link>
      </nav>

      {/* The July-week lineup: live when confirmed, an honest check-back line
          off-season. This section is why the page needs no annual rebuild. */}
      <section className="mb-10">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          The July 4th, {holidayYear} lineup in {guide.town}
        </h2>
        {grouped.length > 0 ? (
          <div className="space-y-8">
            {grouped.map(([date, dayEvents]) => (
              <section key={date}>
                <h3 className="font-display mb-3 border-b border-stone-light/30 pb-1 text-lg font-semibold text-forest">
                  {format(parseISO(date), "EEEE, MMMM d")}
                </h3>
                <SimpleEventList
                  events={dayEvents}
                  newsletterSource={`holiday_${guide.key}`}
                  forecastsByTown={forecastsByTown}
                />
              </section>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-stone">
            Nothing confirmed for {holidayYear} yet. Organizers usually announce
            in late spring, and confirmed events show up here automatically. In
            the meantime, the{" "}
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

      {/* Newsletter — the "tell me when it's confirmed" loop */}
      <section className="mb-4">
        <NewsletterSignup
          source={`holiday_${guide.key}`}
          heading="Want a heads-up when next year firms up?"
          description="One email Thursday morning with what's coming up across the corridor, Angels Camp to Bear Valley. No spam, no ads."
        />
      </section>
    </main>
  );
}
