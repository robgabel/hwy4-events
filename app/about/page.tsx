import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { CORRIDOR_TOWNS } from "@/lib/towns";
import FeedbackForm from "@/components/FeedbackForm";

export const metadata: Metadata = {
  title: "About Hwy 4 Events",
  description:
    "Learn about Hwy 4 Events — a free, community-focused event listing for the Highway 4 corridor from Angels Camp to Bear Valley in the California Sierra.",
  alternates: { canonical: "/about" },
};

function BreadcrumbSchema() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Hwy 4 Events",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "About",
        item: `${SITE_URL}/about`,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

const venues = [
  { name: "Ironstone Vineyards", town: "Murphys" },
  { name: "Murphys Hotel", town: "Murphys" },
  { name: "Murphys Irish Pub", town: "Murphys" },
  { name: "Brice Station Vineyards", town: "Murphys" },
  { name: "The Watering Hole", town: "Arnold" },
  { name: "Branding Iron Saloon", town: "Arnold" },
  { name: "The Lube Room Saloon", town: "Arnold" },
  { name: "Howard's Mystic Saloon", town: "Arnold" },
  { name: "Camp Connell General Store", town: "Camp Connell" },
  { name: "Sequoia Woods Country Club", town: "Arnold" },
  { name: "Bear Valley Mountain Resort", town: "Bear Valley" },
  { name: "Calaveras County Fairgrounds", town: "Angels Camp" },
  { name: "Greenhorn Creek Resort", town: "Angels Camp" },
  { name: "Moose Lodge", town: "Angels Camp" },
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BreadcrumbSchema />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">About</li>
        </ol>
      </nav>

      {/* Header with Millie */}
      <div className="mb-8 flex items-start gap-5">
        <div className="flex-1">
          <h1 className="font-display mb-3 text-3xl font-bold text-forest">
            About {SITE_NAME}
          </h1>
          <p className="text-lg leading-relaxed text-stone">
            {SITE_NAME} is a free, community-focused event listing for the
            Highway 4 corridor in Calaveras County, California. We check 20+
            venues daily so you always know what&apos;s happening — from live music
            in Murphys to ski events at Bear Valley.
          </p>
        </div>
        <Image
          src="/millie-happy.svg"
          alt="Millie the sheepadoodle, our mascot"
          width={80}
          height={80}
          className="hidden shrink-0 opacity-60 sm:block"
        />
      </div>

      {/* Personal note */}
      <div className="mb-10 rounded-xl border border-stone-light/30 bg-warm-white px-6 py-5">
        <p className="leading-relaxed text-stone">
          We built {SITE_NAME} for our family — we have a cabin in Arnold and got
          tired of missing things because events were scattered across a dozen
          websites and Facebook pages. We figured our neighbors might find it
          useful too. It&apos;s a labor of love, not a business. If you notice
          something missing or wrong,{" "}
          <a
            href="mailto:rob@gabel.ai"
            className="font-medium text-pine hover:underline"
          >
            let us know
          </a>
          .
        </p>
      </div>

      {/* Towns */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          Towns we cover
        </h2>
        <p className="mb-4 text-sm text-stone">
          We track events along the full Highway 4 corridor, from the Central
          Valley foothills up to the Sierra summit — west to east by elevation.
        </p>
        <div className="space-y-3">
          {CORRIDOR_TOWNS.map((town) => (
            <div
              key={town.name}
              className="flex items-baseline justify-between rounded-lg border border-stone-light/20 bg-white px-4 py-3"
            >
              <div>
                <Link
                  href={`/?town=${encodeURIComponent(town.name)}`}
                  className="font-semibold text-forest hover:text-pine hover:underline"
                >
                  {town.name}
                </Link>
                <span className="ml-2 text-sm text-stone">
                  {town.tagline}
                </span>
              </div>
              <span className="shrink-0 text-xs text-stone-light">
                {town.elevation.toLocaleString()} ft
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Venues */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          Venues we track
        </h2>
        <p className="mb-4 text-sm text-stone">
          We automatically check these venues for new events. Know a venue we
          should add?{" "}
          <Link href="/submit" className="font-medium text-pine hover:underline">
            Submit it
          </Link>
          .
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {venues.map((v) => (
            <div
              key={v.name}
              className="flex items-center justify-between rounded-lg border border-stone-light/20 bg-white px-4 py-2.5"
            >
              <span className="text-sm font-medium text-forest">{v.name}</span>
              <span className="text-xs text-stone-light">{v.town}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Private / member events */}
      <section className="mb-10">
        <h2 className="font-display mb-2 text-xl font-semibold text-forest">
          Private & member events
        </h2>
        <p className="leading-relaxed text-stone">
          Some venues — like Sequoia Woods Country Club and the Moose Lodge — host
          events that are only open to members and their guests. These events
          aren&apos;t shown by default, but you can opt in to see them using the{" "}
          <strong>Clubs</strong> filter on the{" "}
          <Link href="/" className="font-medium text-pine hover:underline">
            main page
          </Link>
          . Look for the lock icon in the filter bar, toggle on the clubs
          you&apos;re interested in, and their events will appear alongside
          everything else.
        </p>
      </section>

      {/* Event categories */}
      <section className="mb-10">
        <h2 className="font-display mb-2 text-xl font-semibold text-forest">
          What kinds of events?
        </h2>
        <ul className="ml-4 list-disc space-y-1.5 text-stone">
          <li>
            <strong>Live Music</strong> — bands, singer-songwriters, and open
            mic nights at venues from Angels Camp to Bear Valley
          </li>
          <li>
            <strong>Festivals</strong> — the Jumping Frog Jubilee, Murphys Irish
            Day, wine festivals, and seasonal celebrations
          </li>
          <li>
            <strong>Community Events</strong> — civic meetings, farmers markets,
            holiday parades, and volunteer gatherings
          </li>
          <li>
            <strong>Resort Activities</strong> — Bear Valley skiing, summer
            concerts, mountain biking events, and outdoor adventures
          </li>
          <li>
            <strong>Lodge Events</strong> — member-only events from local
            organizations (see above)
          </li>
        </ul>
      </section>

      {/* Getting here */}
      <section className="mb-10">
        <h2 className="font-display mb-2 text-xl font-semibold text-forest">
          Getting here
        </h2>
        <p className="leading-relaxed text-stone">
          The Highway 4 corridor is in Calaveras County in the central Sierra
          Nevada foothills. Angels Camp is about 2 hours east of the Bay Area and
          1.5 hours southeast of Sacramento. Bear Valley is another 30 miles
          further east, rising to over 7,000 feet.
        </p>
      </section>

      {/* Anonymous feedback */}
      <section className="mb-8">
        <h2 className="font-display mb-2 text-xl font-semibold text-forest">
          Send us a note
        </h2>
        <p className="mb-4 text-stone">
          Have feedback, a suggestion, or just want to say hi? We read every
          message. No email required.
        </p>
        <FeedbackForm />
      </section>

      <div className="border-t border-stone-light/30 pt-6">
        <Link
          href="/"
          className="text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to events
        </Link>
      </div>
    </main>
  );
}
