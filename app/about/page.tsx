import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "About the Highway 4 Corridor",
  description:
    "Learn about the Highway 4 corridor through California's Sierra Nevada foothills — Angels Camp, Murphys, Arnold, Bear Valley, and the towns of Calaveras County.",
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

const towns = [
  {
    name: "Angels Camp",
    description:
      "A historic Gold Rush town at the western gateway to the Highway 4 corridor. Famous for the Calaveras County Fair & Jumping Frog Jubilee — inspired by Mark Twain's short story — Angels Camp offers live music venues, local breweries, and community events year-round.",
  },
  {
    name: "Murphys",
    description:
      "Known as the 'Queen of the Sierra,' Murphys is a charming Gold Rush–era village with over 20 wine tasting rooms along Main Street. The town hosts popular events like Murphys Irish Day, outdoor concerts, and seasonal art walks that draw visitors from across California.",
  },
  {
    name: "Arnold",
    description:
      "A mountain community nestled among towering pines at about 4,000 feet elevation. Arnold serves as a gateway to Calaveras Big Trees State Park and offers a mix of community events, local restaurants, and outdoor recreation throughout the year.",
  },
  {
    name: "Avery",
    description:
      "A small, tight-knit community between Arnold and Murphys. Avery is home to local gathering spots and community organizations that host regular events for residents and visitors.",
  },
  {
    name: "Dorrington",
    description:
      "A quiet mountain hamlet surrounded by Sierra Nevada forest. Dorrington's historic hotel and surrounding area host seasonal events and serve as a peaceful stop along the Highway 4 corridor.",
  },
  {
    name: "Bear Valley",
    description:
      "A four-season mountain resort at over 7,000 feet elevation. Bear Valley is best known for skiing and snowboarding in winter, but summer brings music festivals, mountain biking events, hiking gatherings, and family-friendly outdoor activities.",
  },
  {
    name: "White Pines",
    description:
      "A residential community between Arnold and Avery with community events centered around local parks and gathering spaces.",
  },
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

      <h1 className="mb-2 text-3xl font-bold text-forest">
        About the Highway 4 Corridor
      </h1>
      <p className="mb-8 text-lg leading-relaxed text-stone">
        California State Route 4 climbs from the Central Valley through the
        Sierra Nevada foothills of Calaveras County, connecting a string of
        historic Gold Rush towns, mountain communities, and alpine resorts. The
        Highway 4 corridor is home to live music, festivals, wine tasting,
        outdoor adventure, and community events year-round.
      </p>

      <section className="mb-10">
        <h2 className="mb-2 text-xl font-semibold text-forest">
          What is Hwy 4 Events?
        </h2>
        <p className="leading-relaxed text-stone">
          Hwy 4 Events is a free, community-focused event listing for the
          Highway 4 corridor. We aggregate live music, festivals, civic
          gatherings, resort activities, and community events from Angels Camp to
          Bear Valley — updated daily so you never miss what&apos;s happening in the
          Sierra foothills.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold text-forest">
          Towns Along Highway 4
        </h2>
        <div className="space-y-4">
          {towns.map((town) => (
            <div
              key={town.name}
              className="rounded-xl border border-stone-light/30 bg-white p-5 shadow-sm"
            >
              <h3 className="mb-1.5 text-lg font-semibold text-forest">
                {town.name}
              </h3>
              <p className="leading-relaxed text-stone">{town.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-2 text-xl font-semibold text-forest">
          What kinds of events can I find here?
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
            organizations like the Moose Lodge
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold text-forest">
          How to get to the Highway 4 corridor
        </h2>
        <p className="leading-relaxed text-stone">
          The Highway 4 corridor is located in Calaveras County in the central
          Sierra Nevada foothills of California. Angels Camp is approximately 2
          hours east of the San Francisco Bay Area via Highway 4 and about 1.5
          hours southeast of Sacramento via Highway 49. Bear Valley is about 30
          miles further east along Highway 4, rising to over 7,000 feet in the
          Sierra Nevada mountains.
        </p>
      </section>

      <div className="mt-10 border-t border-stone-light/30 pt-6">
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
