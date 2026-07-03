import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { CORRIDOR_TOWNS } from "@/lib/towns";
import { townSlug } from "@/lib/slugs";
import { getPublishedTownSlugs } from "@/app/towns/town-content";
import { getSupabase } from "@/lib/supabase";
import FeedbackForm from "@/components/FeedbackForm";
import NewsletterSignup from "@/components/NewsletterSignup";
import { serializeJsonLd } from "@/lib/json-ld";

export const metadata: Metadata = {
  title: "About Hwy 4 Events",
  description:
    "Your neighbor's guide to what's happening on the Highway 4 corridor, from Angels Camp to Bear Valley. Free community event listings, updated daily.",
  alternates: { canonical: "/about" },
};

export const revalidate = 3600;

async function getVenuesByTown(): Promise<{ town: string; venues: string[] }[]> {
  const { data, error } = await getSupabase()
    .from("hwy4_orgs")
    .select("display_name, town")
    .eq("show_on_about", true)
    .order("town")
    .order("display_name");

  if (error || !data) return [];

  const townOrder = CORRIDOR_TOWNS.map((t) => t.name);
  const grouped = new Map<string, string[]>();
  for (const row of data) {
    if (!row.town || !row.display_name) continue;
    const list = grouped.get(row.town) ?? [];
    list.push(row.display_name);
    grouped.set(row.town, list);
  }

  return [...grouped.entries()]
    .map(([town, venues]) => ({ town, venues }))
    .sort((a, b) => {
      const ai = townOrder.indexOf(a.town);
      const bi = townOrder.indexOf(b.town);
      if (ai === -1 && bi === -1) return a.town.localeCompare(b.town);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
}

// Live distinct-venue count from hwy4_events, filtered to drop obvious junk
// (Featuring/Hosted by/leading-@, address-as-venue rows with commas, Unknown Venue).
// Bucketed to the nearest 5 so we don't churn copy every time a new venue appears.
async function getLiveVenueCount(): Promise<number> {
  const { data, error } = await getSupabase().rpc("hwy4_distinct_venue_count");
  if (error || data == null) return 80; // safe fallback
  const n = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(n)) return 80;
  return Math.max(5, Math.floor(n / 5) * 5);
}

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
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
    />
  );
}

export default async function AboutPage() {
  const [venuesByTown, liveVenueCount] = await Promise.all([
    getVenuesByTown(),
    getLiveVenueCount(),
  ]);

  // Towns that have a published landing page get a direct link; others fall
  // back to the filtered homepage view. Lets us light up town links as each
  // page ships without going back to edit About every time.
  const publishedTowns = new Set(getPublishedTownSlugs());

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

      {/* ============================================ */}
      {/* TOP ZONE                                     */}
      {/* ============================================ */}

      {/* Hero */}
      <div className="mb-8 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <Image
          src="/millie-happy.svg"
          alt="Millie the sheepadoodle, our mascot"
          width={100}
          height={100}
          className="shrink-0"
          priority
        />
        <div>
          <h1 className="font-display mb-3 text-center text-3xl font-bold text-forest sm:text-left">
            Your neighbor&apos;s guide to what&apos;s happening on the 4
          </h1>
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            A free community event listing for the Highway 4 corridor, from
            Angels Camp to Bear Valley.
          </p>
        </div>
      </div>

      {/* Personal note */}
      <address
        rel="author"
        className="not-italic mb-10 rounded-xl border border-stone-light/30 bg-warm-white px-6 py-5"
      >
        <p className="leading-relaxed text-stone">
          I&apos;m{" "}
          <Link
            href="/about/rob-gabel"
            className="font-medium text-pine hover:underline"
          >
            Rob
          </Link>
          . My family has had a place on Thunderbolt in Arnold since 2015. We
          kept missing things because events were scattered across a dozen
          websites, Facebook groups, and flyers at the Lube Room. So I built
          this. First for us, then for our neighbors. It&apos;s a labor of
          love, not a business. If you notice something missing or wrong,{" "}
          <a
            href="#feedback"
            className="font-medium text-pine hover:underline"
          >
            send me a note
          </a>{" "}
          or find me on{" "}
          <a
            href="https://www.linkedin.com/in/robgabel"
            target="_blank"
            rel="noopener noreferrer me"
            className="font-medium text-pine hover:underline"
          >
            LinkedIn
          </a>
          . That&apos;s Millie, who came into our lives through{" "}
          <a
            href="https://www.californiadoodlerescue.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-pine hover:underline"
          >
            California Doodle Rescue
          </a>{" "}
          (We also LOVE and support{" "}
          <a
            href="https://calaverashumane.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-pine hover:underline"
          >
            Calaveras Humane Society
          </a>
          ). She comes with us every trip and has strong opinions about which
          events involve food.
        </p>
      </address>

      {/* Three value props */}
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-light/20 bg-white px-5 py-4 text-center">
          <div className="mb-2 text-2xl">&#x1F50D;</div>
          <h3 className="font-display mb-1 font-semibold text-forest">
            Updated every morning
          </h3>
          <p className="text-sm leading-relaxed text-stone">
            We check {liveVenueCount}+ venues daily so you don&apos;t have to.
            If it&apos;s happening on the 4, it&apos;s here.
          </p>
        </div>
        <div className="rounded-xl border border-stone-light/20 bg-white px-5 py-4 text-center">
          <div className="mb-2 text-2xl">&#x1F4DD;</div>
          <h3 className="font-display mb-1 font-semibold text-forest">
            This Week on the 4
          </h3>
          <p className="text-sm leading-relaxed text-stone">
            A short read on what&apos;s worth your evening, every morning.
          </p>
        </div>
        <div className="rounded-xl border border-stone-light/20 bg-white px-5 py-4 text-center">
          <div className="mb-2 text-2xl">&#x2B50;</div>
          <h3 className="font-display mb-1 font-semibold text-forest">
            Hand-picked highlights
          </h3>
          <p className="text-sm leading-relaxed text-stone">
            Not everything is worth your Saturday. I flag the ones that are
            actually worth going to.
          </p>
        </div>
      </div>

      {/* Who this is for */}
      <NewsletterSignup variant="inline" source="about" />
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          This is for you if...
        </h2>
        <ul className="space-y-2.5 text-stone">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&#x2192;</span>
            <span>
              You live up here and want one place to check instead of five
              Facebook groups
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&#x2192;</span>
            <span>
              You&apos;re a BLS, Sequoia Woods, or Moose Lodge member looking
              for member events alongside public ones
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&#x2192;</span>
            <span>
              You&apos;ve got kids and want to know what&apos;s family-friendly
              this weekend
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&#x2192;</span>
            <span>
              You own a vacation rental and want to tell guests what&apos;s
              happening during their stay
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&#x2192;</span>
            <span>
              You&apos;re in Stockton or the Bay Area thinking about driving up
              and wondering if it&apos;s worth the trip
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&#x2192;</span>
            <span>
              You already know everyone at Bistro Espresso but still want to
              make sure you&apos;re not missing anything
            </span>
          </li>
        </ul>
      </section>

      {/* Primary CTA */}
      <div className="mb-16 text-center">
        <Link
          href="/"
          className="inline-block rounded-lg bg-pine px-8 py-3 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-forest"
        >
          See what&apos;s happening this weekend &rarr;
        </Link>
      </div>

      {/* ============================================ */}
      {/* VISUAL BREAK                                 */}
      {/* ============================================ */}

      <div className="mb-12 flex items-center gap-4">
        <div className="h-px flex-1 bg-stone-light/30" />
        <Image
          src="/paw-print.svg"
          alt=""
          width={20}
          height={20}
          className="opacity-30"
        />
        <div className="h-px flex-1 bg-stone-light/30" />
      </div>

      {/* ============================================ */}
      {/* BOTTOM ZONE                                  */}
      {/* ============================================ */}

      {/* Towns */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          Towns we cover
        </h2>
        <p className="mb-4 text-sm text-stone">
          9 towns along 50 miles of Highway 4, from the foothills to the
          summit.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CORRIDOR_TOWNS.map((town) => {
            const slug = townSlug(town.name);
            const hasPage = publishedTowns.has(slug);
            const href = hasPage
              ? `/towns/${slug}`
              : `/?town=${encodeURIComponent(town.name)}`;
            return (
              <Link
                key={town.name}
                href={href}
                className="rounded-lg border border-stone-light/20 bg-white px-3 py-2 transition-colors hover:border-pine/30"
              >
                <span className="text-sm font-semibold text-forest">
                  {town.name}
                </span>
                <span className="block text-xs text-stone-light">
                  {town.elevation.toLocaleString()} ft
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Venues grouped by town */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          Venues we track
        </h2>
        <p className="mb-4 text-sm text-stone">
          We pull events from {liveVenueCount}+ venues across the corridor. The
          regulars worth knowing are below. Know one we should add?{" "}
          <Link href="/submit" className="font-medium text-pine hover:underline">
            Submit it
          </Link>
          .
        </p>
        <div className="space-y-4">
          {venuesByTown.map((group) => (
            <div key={group.town}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-light">
                {group.town}
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.venues.map((name) => (
                  <div
                    key={name}
                    className="rounded-lg border border-stone-light/20 bg-white px-4 py-2.5"
                  >
                    <span className="text-sm font-medium text-forest">
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Families & members */}
      <section className="mb-10">
        <h2 className="font-display mb-3 text-xl font-semibold text-forest">
          Families & members welcome
        </h2>
        <div className="space-y-4 leading-relaxed text-stone">
          <p>
            Plenty of events on the 4 are great for kids, from the playground
            at White Pines Lake to summer movies at Blue Lake Springs.
            Community events, festivals, and anything in the Kids category are
            your best bet for family-friendly outings.
          </p>
          <p>
            Blue Lake Springs, Sequoia Woods Country Club, and the Moose Lodge
            host events that are only open to members and their guests. These
            aren&apos;t shown by default, but you can opt in using the{" "}
            <strong>Clubs</strong> filter on the{" "}
            <Link href="/" className="font-medium text-pine hover:underline">
              main page
            </Link>
            . Look for the lock icon, toggle on the clubs you belong to, and
            their events will appear alongside everything else.
          </p>
        </div>
      </section>

      {/* Event categories */}
      <section className="mb-10">
        <h2 className="font-display mb-2 text-xl font-semibold text-forest">
          What kinds of events?
        </h2>
        <ul className="ml-4 list-disc space-y-1.5 text-stone">
          <li>
            <strong>Live Music</strong>: bands, singer-songwriters, and open
            mic nights at venues from Angels Camp to Bear Valley
          </li>
          <li>
            <strong>Festivals</strong>: the Jumping Frog Jubilee, Murphys Irish
            Day, wine festivals, and seasonal celebrations
          </li>
          <li>
            <strong>Community Events</strong>: civic meetings, farmers markets,
            holiday parades, and volunteer gatherings
          </li>
          <li>
            <strong>Hike &amp; Walk</strong>: trail hikes, nature walks, and
            group outings like the Arnold Rim Trail
          </li>
          <li>
            <strong>Kids</strong>: family events, story times, and things to do
            with the little ones
          </li>
          <li>
            <strong>Wine</strong>: tastings, winemaker dinners, and release
            parties around Murphys
          </li>
          <li>
            <strong>Games</strong>: trivia nights, bingo, and card and board
            game meetups
          </li>
        </ul>
      </section>

      {/* Feedback form */}
      <section id="feedback" className="mb-8 scroll-mt-20">
        <h2 className="font-display mb-2 text-xl font-semibold text-forest">
          Send me a note
        </h2>
        <p className="mb-4 text-stone">
          Have feedback, a suggestion, or just want to say hi? I read every
          message. No email required.
        </p>
        <FeedbackForm />
      </section>

      {/* Footer CTA + back link */}
      <div className="flex items-center justify-between border-t border-stone-light/30 pt-6">
        <Link
          href="/"
          className="text-sm font-medium text-pine hover:underline"
        >
          &larr; Back to events
        </Link>
        <Link
          href="/"
          className="rounded-lg bg-pine px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest"
        >
          See this weekend&apos;s events &rarr;
        </Link>
      </div>
    </main>
  );
}
