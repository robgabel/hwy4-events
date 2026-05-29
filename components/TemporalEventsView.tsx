import Link from "next/link";
import Image from "next/image";
import { format, parseISO } from "date-fns";

import { SITE_URL } from "@/lib/constants";
import { getSupabase } from "@/lib/supabase";
import { Hwy4Event } from "@/lib/types";
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
import { getPublishedTownSlugs, getTownContent } from "@/app/towns/town-content";
import { TEMPORAL_CONFIG, type WindowKey } from "@/lib/date-windows";

const EVENT_COLUMNS =
  "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, event_url, source_url, source_name, visibility, org_slug, importance, robs_pick, is_weekly, image_url";

async function getEventsInRange(
  start: string,
  end: string
): Promise<Hwy4Event[]> {
  const PAGE_SIZE = 1000;
  let all: Hwy4Event[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await getSupabase()
      .from("hwy4_events")
      .select(EVENT_COLUMNS)
      .gte("date", start)
      .lte("date", end)
      .neq("status", "cancelled")
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[getEventsInRange]", error);
      break;
    }
    all = all.concat((data ?? []) as Hwy4Event[]);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

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
}: {
  windowKey: WindowKey;
}) {
  const cfg = TEMPORAL_CONFIG[windowKey];
  const range = cfg.getRange();
  const events = await getEventsInRange(range.start, range.end);
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

      {/* Events grouped by day */}
      {grouped.length > 0 ? (
        <div className="mb-10 space-y-8">
          {grouped.map(([date, dayEvents]) => (
            <section key={date}>
              <h2 className="font-display mb-3 border-b border-stone-light/30 pb-1 text-lg font-semibold text-forest">
                {format(parseISO(date), "EEEE, MMMM d")}
              </h2>
              <SimpleEventList events={dayEvents} />
            </section>
          ))}
        </div>
      ) : (
        <p className="mb-10 rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-stone">
          Nothing on the calendar for this window yet. Check the{" "}
          <Link href="/" className="font-medium text-pine hover:underline">
            full corridor list
          </Link>
          , or check back. New events get added daily.
        </p>
      )}

      {/* Newsletter */}
      <section className="mb-10">
        <NewsletterSignup
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
