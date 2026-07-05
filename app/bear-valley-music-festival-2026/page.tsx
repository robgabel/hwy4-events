import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { format, parseISO } from "date-fns";

import { SITE_URL } from "@/lib/constants";
import type { Hwy4Event } from "@/lib/types";
import { getEventsInRange } from "@/lib/events-data";
import { generateEventSlug } from "@/lib/slugs";
import { pacificToday } from "@/lib/date-windows";
import {
  JsonLd,
  buildBreadcrumbs,
  buildFaqPage,
  buildItemList,
  buildWebPage,
} from "@/lib/schema";
import NewsletterSignup from "@/components/NewsletterSignup";

// Festival landing page (Roadmap ticket HWY-3, filed by the growth memo).
// Target query: "bear valley music festival 2026" (326 impressions at position
// 5.9 with 1 click when filed). Title tag and H1 match the brief exactly.
//
// Same editorial contract as the intent pages (lib/intent-pages.ts): copy here
// is fixed and human-written, never LLM-generated at runtime, no em dashes.
// The lineup itself is live DB data, so the page stays honest as shows pass:
// upcoming shows render as the lineup; once the run ends it degrades to a
// wrap-up note pointing at the live calendar.

const PATH = "/bear-valley-music-festival-2026";
const H1 = "Bear Valley Music Festival 2026: Dates, Lineup, and What to Do";
const META_DESCRIPTION =
  "Bear Valley Music Festival 2026 runs July 17 to August 2 under the Big White Tent in Bear Valley, CA. Dates, nightly lineup, getting there on Highway 4, and what else is on nearby.";

// The run, per the festival's published 2026 schedule (mirrored in our events
// table from the organizer + GoCalaveras). Static fallback so the dates section
// still reads correctly after the shows age out of the upcoming-events window.
const FEST_START = "2026-07-17";
const FEST_END = "2026-08-02";
const OFFICIAL_URL = "https://www.bearvalleymusicfestival.org/2026-festival";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: H1,
  description: META_DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    title: H1,
    description: META_DESCRIPTION,
    type: "website",
    url: `${SITE_URL}${PATH}`,
  },
  twitter: {
    card: "summary_large_image",
    title: H1,
    description: META_DESCRIPTION,
  },
};

const EDITORIAL: string[] = [
  "Every summer the Bear Valley Music Festival sets up its Big White Tent in the village at Bear Valley, 7,000 feet up Highway 4, and runs two-plus weeks of music that swings from symphony nights to Bowie and ELO tributes. The 2026 run is July 17 through August 2.",
  "Most evening shows start at 7, with a couple of Sunday matinees at 2. The lineup below comes from our live corridor calendar, which updates daily; for tickets, seating, and the full program, the festival's own site is the source of truth.",
];

const QA: { q: string; a: string }[] = [
  {
    q: "When is the Bear Valley Music Festival in 2026?",
    a: "July 17 through August 2, 2026. Most evening concerts start at 7 pm, with Sunday afternoon shows around 2 pm and a gala evening on the final Saturday. Check the festival site before you drive, since individual show times can shift.",
  },
  {
    q: "Where is the festival held?",
    a: "Under the Big White Tent in Bear Valley village, just off Highway 4 at about 7,000 feet, roughly 40 minutes above Arnold. It is an open-sided mountain venue, so bring a warm layer: even July evenings cool off fast at that elevation.",
  },
  {
    q: "Where should we stay for the festival?",
    a: "Lodging in Bear Valley village itself is limited, so book early if you want to walk to the tent. Most festival-goers stay down the hill in Arnold, Dorrington, or Camp Connell, about 30 to 40 minutes away, or in Murphys, about an hour, where dinner options before the drive up are strongest.",
  },
  {
    q: "What else is going on nearby during the festival?",
    a: "Plenty. Calaveras Big Trees State Park sits between Arnold and Bear Valley for a giant-sequoia walk before an evening show, Murphys Main Street has tasting rooms and live music most weekends, and our This Weekend page lists everything happening along the corridor on any given festival weekend.",
  },
];

function isFestivalEvent(e: Hwy4Event): boolean {
  return (
    e.visibility === "public" &&
    (e.venue_key === "big-white-tent" ||
      e.name.toLowerCase().includes("bear valley music festival"))
  );
}

// The umbrella row (the season card, NULL start time) anchors the page's dates;
// the timed rows are the actual shows.
function splitFestival(events: Hwy4Event[]): {
  shows: Hwy4Event[];
} {
  const shows = events
    .filter((e) => e.start_time != null)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "")
    );
  return { shows };
}

// Same 12-hour rendering as EventCard's local helper (it isn't exported).
function formatShowTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function showTitle(e: Hwy4Event): string {
  const artist = e.artists?.[0];
  return artist && artist.trim().length > 0 ? artist : e.name;
}

export default async function BvmfPage() {
  const today = pacificToday().iso;
  const rangeStart = today > FEST_START ? today : FEST_START;
  const inRange =
    today > FEST_END ? [] : await getEventsInRange(rangeStart, FEST_END);
  const { shows } = splitFestival(inRange.filter(isFestivalEvent));
  const festivalOver = today > FEST_END;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={buildBreadcrumbs([
          { name: "Hwy 4 Events", url: SITE_URL },
          { name: "Bear Valley Music Festival 2026", url: `${SITE_URL}${PATH}` },
        ])}
      />
      <JsonLd
        data={buildWebPage({
          url: `${SITE_URL}${PATH}`,
          name: H1,
          description: META_DESCRIPTION,
          dateModified: new Date().toISOString().split("T")[0],
        })}
      />
      <JsonLd data={buildFaqPage(QA.map((x) => ({ question: x.q, answer: x.a })))} />
      {shows.length > 0 && (
        <JsonLd
          data={buildItemList(shows, {
            name: H1,
            description: META_DESCRIPTION,
            limit: 20,
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
          <li className="text-stone-light">Bear Valley Music Festival 2026</li>
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
            {H1}
          </h1>
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            {"Two-plus weeks of symphony, tributes, and mountain evenings under the Big White Tent, July 17 to August 2."}
          </p>
        </div>
      </div>

      {/* Editorial intro */}
      <div className="mb-8 space-y-3">
        {EDITORIAL.map((p) => (
          <p key={p.slice(0, 24)} className="leading-relaxed text-stone">
            {p}
          </p>
        ))}
      </div>

      {/* Dates and location */}
      <section className="mb-8">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          Dates and location
        </h2>
        <p className="leading-relaxed text-stone">
          {
            "The 2026 festival runs Friday, July 17 through Sunday, August 2 at the Big White Tent in Bear Valley village, off Highway 4 in Alpine County. Our listings sync daily from the festival and local calendars; if a date here ever disagrees with "
          }
          <a
            href={OFFICIAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-pine hover:underline"
          >
            bearvalleymusicfestival.org
          </a>
          {", trust the festival's site and tell us."}
        </p>
      </section>

      {/* Lineup: live from the corridor calendar */}
      <section className="mb-8">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          {festivalOver ? "The 2026 lineup" : "Lineup"}
        </h2>
        {shows.length > 0 ? (
          <>
            <ul className="divide-y divide-stone-light/20 overflow-hidden rounded-lg border border-stone-light/30 bg-white">
              {shows.map((e) => {
                const slug = generateEventSlug(e.name, e.date, e.town);
                return (
                  <li key={`${e.date}-${e.start_time}`}>
                    <Link
                      href={`/events/${slug}`}
                      className="flex items-baseline justify-between gap-3 px-4 py-3 transition-colors hover:bg-cream"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-forest">
                          {showTitle(e)}
                        </span>
                        <span className="block text-sm text-stone">
                          {format(parseISO(e.date), "EEEE, MMMM d")}
                          {e.start_time
                            ? ` · ${formatShowTime(e.start_time)}`
                            : ""}
                        </span>
                      </span>
                      <span aria-hidden className="text-stone-light">
                        ›
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-sm text-stone">
              {"Remaining shows, updated daily. Tickets and full program at "}
              <a
                href={OFFICIAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-pine hover:underline"
              >
                bearvalleymusicfestival.org
              </a>
              {"."}
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-stone-light/30 bg-white px-4 py-3 leading-relaxed text-stone">
            {festivalOver
              ? "The 2026 festival has wrapped. The tent comes down, Bear Valley goes back to being quiet, and the corridor calendar rolls on: see "
              : "The nightly schedule has not landed on our calendar yet. It syncs daily; meanwhile the full program is at bearvalleymusicfestival.org, and for everything else nearby see "}
            <Link href="/this-weekend" className="font-medium text-pine hover:underline">
              This Weekend
            </Link>
            {" or the "}
            <Link href="/" className="font-medium text-pine hover:underline">
              full corridor calendar
            </Link>
            {"."}
          </p>
        )}
      </section>

      {/* Getting there */}
      <section className="mb-8">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          Getting there
        </h2>
        <div className="space-y-3 leading-relaxed text-stone">
          <p>
            {
              "Bear Valley is the top of the Highway 4 corridor: from Angels Camp it is about 10 minutes to Murphys, 20 more to Arnold, then another 40 or so up the mountain grade to the village. The last stretch climbs about 3,000 feet, so give yourself more time than the map says, especially before a 7 pm downbeat."
            }
          </p>
          <p>
            {
              "Parking in the village is close to the tent, but festival nights fill it; arriving early is the honest advice. Evenings at 7,000 feet drop into the 50s even in late July, so bring a real layer. Coming up for the day, Calaveras Big Trees State Park and the towns of Arnold, Dorrington, and Camp Connell are all on your way."
            }
          </p>
        </div>
      </section>

      {/* What else is open that weekend */}
      <section className="mb-8">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          What else is on while you're up here
        </h2>
        <p className="mb-3 leading-relaxed text-stone">
          {
            "Festival weekends are the corridor at full tilt: live music in Murphys and Arnold, winery evenings, markets, and trail days all stack up alongside the tent schedule. The live list is one click away."
          }
        </p>
        <nav aria-label="Nearby events" className="flex flex-wrap gap-2">
          <Link
            href="/this-weekend"
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            This Weekend
          </Link>
          <Link
            href="/towns/bear-valley"
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            Bear Valley
          </Link>
          <Link
            href="/towns/arnold"
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            Arnold
          </Link>
          <Link
            href="/towns/murphys"
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            Murphys
          </Link>
          <Link
            href="/"
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            Full calendar
          </Link>
        </nav>
      </section>

      {/* Q&A: written to resolve the searches that land here */}
      <section className="mb-10">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          Good to know
        </h2>
        <div className="space-y-4">
          {QA.map((item) => (
            <div key={item.q}>
              <h3 className="font-semibold text-forest">{item.q}</h3>
              <p className="speakable mt-1 leading-relaxed text-stone">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Newsletter */}
      <section className="mb-4">
        <NewsletterSignup
          source="bvmf_2026"
          heading="Coming up for the festival?"
          description="One email Thursday morning with what's on across the corridor, Angels Camp to Bear Valley. No spam, no ads."
        />
      </section>
    </main>
  );
}
