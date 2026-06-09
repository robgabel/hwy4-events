import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

import { SITE_URL } from "@/lib/constants";
import { CORRIDOR_TOWNS, TOWN_INFO, TownInfo } from "@/lib/towns";
import { townSlug } from "@/lib/slugs";
import { getSupabase } from "@/lib/supabase";
import { getEventsInTown } from "@/lib/events-data";
import {
  JsonLd,
  buildBreadcrumbs,
  buildItemList,
  buildTouristAttraction,
  buildFaqPage,
  buildWebPage,
} from "@/lib/schema";
import {
  getTownContent,
  getAllTownSlugs,
  type TownContent,
} from "@/app/towns/town-content";
import SimpleEventList from "@/components/SimpleEventList";
import NewsletterSignup from "@/components/NewsletterSignup";
import { linkifyPhones } from "@/lib/linkify";

export const revalidate = 3600;

type PageProps = { params: Promise<{ slug: string }> };

// ---------- data ----------

// getEventsInTown now lives in lib/events-data.ts — an in-memory filter over the
// site-wide cached upcoming-events set. No per-town database scan.

async function getVenuesInTown(townName: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("hwy4_orgs")
    .select("display_name")
    .eq("town", townName)
    .eq("show_on_about", true)
    .order("display_name");

  if (error || !data) return [];
  return data.map((row) => row.display_name).filter(Boolean) as string[];
}

// ---------- static params + metadata ----------

export async function generateStaticParams() {
  return getAllTownSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const content = getTownContent(slug);
  if (!content) return { title: "Town not found" };

  return {
    title: content.metaTitle,
    description: content.metaDescription,
    alternates: { canonical: `/towns/${slug}` },
    // Drafts: tell crawlers not to index or follow.
    ...(content.draft && {
      robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: { index: false, follow: false },
      },
    }),
    openGraph: {
      title: content.metaTitle,
      description: content.metaDescription,
      type: "website",
      url: `${SITE_URL}/towns/${slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title: content.metaTitle,
      description: content.metaDescription,
    },
  };
}

// ---------- page ----------

export default async function TownPage({ params }: PageProps) {
  const { slug } = await params;
  const content = getTownContent(slug);
  if (!content) notFound();

  const town: TownInfo | undefined = TOWN_INFO[content.townName];
  if (!town) notFound();

  const [events, venues] = await Promise.all([
    getEventsInTown(content.townName),
    getVenuesInTown(content.townName),
  ]);

  const nearby = pickNearbyTowns(town, 3);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={buildBreadcrumbs([
          { name: "Hwy 4 Events", url: SITE_URL },
          { name: "Towns", url: `${SITE_URL}/towns` },
          { name: town.name, url: `${SITE_URL}/towns/${slug}` },
        ])}
      />
      {!content.draft && (
        <JsonLd
          data={buildWebPage({
            url: `${SITE_URL}/towns/${slug}`,
            name: content.metaTitle,
            description: content.metaDescription,
            dateModified: content.lastVerified,
          })}
        />
      )}
      <JsonLd data={buildTouristAttraction(town, slug)} />
      {events.length > 0 && (
        <JsonLd
          data={buildItemList(events, {
            name: `Upcoming events in ${town.name}, CA`,
            description: `Live music, festivals, and community events in ${town.name} along Highway 4.`,
          })}
        />
      )}
      <JsonLd data={buildFaqPage(content.faqs)} />

      {/* Draft banner: page is unverified, not indexed, not in sitemap */}
      {content.draft && (
        <div
          role="alert"
          className="mb-6 rounded-lg border-2 border-sunset/40 bg-sunset/5 px-4 py-3 text-sm text-earth"
        >
          <p className="font-display font-semibold text-sunset">
            Draft, pending verification.
          </p>
          <p className="mt-1 leading-relaxed">
            Facts on this page have not been independently verified against
            primary sources yet. Not indexed, not in sitemap, not for public
            sharing. Visible to anyone with the URL, but search engines have
            been told to skip it.
          </p>
        </div>
      )}

      {/* Breadcrumb (visible) */}
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">{town.name}</li>
        </ol>
      </nav>

      {/* Hero */}
      <div className="mb-8 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <Image
          src="/millie-happy.svg"
          alt={`Millie the sheepadoodle waiting outside in ${town.name}`}
          width={88}
          height={88}
          className="shrink-0"
          priority
        />
        <div>
          <h1 className="font-display mb-2 text-center text-3xl font-bold text-forest sm:text-left">
            {content.h1}
          </h1>
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            {content.subhead}
          </p>
          <p className="mt-2 text-center text-xs uppercase tracking-wide text-stone-light sm:text-left">
            {town.elevation.toLocaleString()} ft
          </p>
        </div>
      </div>

      {/* Lead: always-visible teaser + collapsed full intro behind a Read
       * more toggle. The teaser carries the highest-AEO answer text above
       * the fold; the rest is opt-in long-form for visitors who want it. */}
      <section className="speakable mb-10 rounded-xl border border-stone-light/30 bg-warm-white px-6 py-5">
        <p className="leading-relaxed text-stone">{content.introTeaser}</p>
        {content.intro.length > 0 && (
          <details className="group mt-4">
            <summary className="cursor-pointer list-none font-medium text-pine marker:hidden hover:underline">
              <span className="inline-block transition-transform group-open:rotate-90">
                &rsaquo;
              </span>{" "}
              Read more about {town.name}
            </summary>
            <div className="mt-4 space-y-4 leading-relaxed text-stone">
              {content.intro.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Upcoming events: moved above the long-form intro because repeat
       * visitors want "what's tonight" first. */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          What&apos;s happening in {town.name}
        </h2>
        {events.length > 0 ? (
          <>
            <SimpleEventList events={events.slice(0, 10)} newsletterAfterIndex={4} newsletterSource={`town_${slug}`} />
            {events.length > 10 && (
              <p className="mt-4 text-sm text-stone">
                <Link
                  href={`/?town=${encodeURIComponent(town.name)}`}
                  className="font-medium text-pine hover:underline"
                >
                  See all {events.length} upcoming events in {town.name} &rarr;
                </Link>
              </p>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-stone-light/30 bg-white px-4 py-3 text-sm text-stone">
            Nothing on the calendar in {town.name} right now. Check the{" "}
            <Link href="/" className="font-medium text-pine hover:underline">
              full corridor list
            </Link>
            . There&apos;s usually something nearby.
          </p>
        )}
      </section>

      {/* Worth a trip if... persona-targeted bullets */}
      {content.personaNotes.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display mb-4 text-xl font-semibold text-forest">
            Worth a trip if&hellip;
          </h2>
          <ul className="space-y-2.5 text-stone">
            {content.personaNotes.map((note, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-pine">&rarr;</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Worth knowing: falsifiable local facts. Major AEO signal. */}
      {content.worthKnowing.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display mb-4 text-xl font-semibold text-forest">
            Worth knowing
          </h2>
          <ul className="speakable space-y-2.5 text-stone">
            {content.worthKnowing.map((fact, i) => (
              <li key={i} className="flex items-start gap-2 leading-relaxed">
                <span className="mt-0.5 shrink-0 text-pine">&middot;</span>
                <span>{linkifyPhones(fact)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Newsletter signup. Sits after the high-density AEO content (Worth
       * knowing) so a visitor who has gotten value is in the right moment
       * to opt in. Town-specific framing keeps the value prop concrete. */}
      <section className="mb-10">
        <NewsletterSignup
          source={`town_${slug}`}
          heading="Want a Thursday heads-up?"
          description={`One email Thursday morning with what's coming up in ${town.name} and the rest of the corridor. No spam, no ads.`}
        />
      </section>

      {/* Venues we track in this town */}
      {venues.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display mb-4 text-xl font-semibold text-forest">
            Venues we track in {town.name}
          </h2>
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {venues.map((v) => (
              <li
                key={v}
                className="rounded-lg border border-stone-light/20 bg-white px-3 py-2 text-stone"
              >
                {v}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* FAQ */}
      {content.faqs.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display mb-4 text-xl font-semibold text-forest">
            About {town.name}
          </h2>
          <div className="space-y-3">
            {content.faqs.map((qa, i) => (
              <details
                key={i}
                className="group rounded-lg border border-stone-light/30 bg-white px-4 py-3"
              >
                <summary className="cursor-pointer list-none font-display font-semibold text-forest marker:hidden">
                  <span className="inline-block transition-transform group-open:rotate-90">
                    &rsaquo;
                  </span>{" "}
                  {qa.question}
                </summary>
                <p className="speakable mt-2 leading-relaxed text-stone">
                  {linkifyPhones(qa.answer)}
                </p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Divider */}
      <div className="mb-10 flex items-center gap-4">
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

      {/* Nearby towns: internal link graph */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          Nearby on the 4
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {nearby.map((nb) => {
            const nbSlug = townSlug(nb.name);
            const hasPage = getTownContent(nbSlug);
            const className =
              "rounded-lg border border-stone-light/20 bg-white px-3 py-2 transition-colors hover:border-pine/30";
            return hasPage ? (
              <Link key={nb.name} href={`/towns/${nbSlug}`} className={className}>
                <span className="text-sm font-semibold text-forest">
                  {nb.name}
                </span>
                <span className="block text-xs text-stone-light">
                  {nb.elevation.toLocaleString()} ft &middot; {nb.tagline}
                </span>
              </Link>
            ) : (
              <Link
                key={nb.name}
                href={`/?town=${encodeURIComponent(nb.name)}`}
                className={className}
              >
                <span className="text-sm font-semibold text-forest">
                  {nb.name}
                </span>
                <span className="block text-xs text-stone-light">
                  {nb.elevation.toLocaleString()} ft &middot; {nb.tagline}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Byline: E-E-A-T signal */}
      <address className="not-italic text-xs text-stone-light" rel="author">
        Maintained by{" "}
        <Link href="/about" className="text-pine hover:underline">
          Rob Gabel
        </Link>
        , local resident.{" "}
        {content.draft ? "Pending verification." : `Last verified ${content.lastVerified}.`}
      </address>
    </main>
  );
}

// ---------- helpers ----------

function pickNearbyTowns(self: TownInfo, count: number): TownInfo[] {
  const ordered = CORRIDOR_TOWNS.map((t) => ({
    t,
    diff: Math.abs(t.elevation - self.elevation),
  }))
    .filter((x) => x.t.name !== self.name)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, count)
    .map((x) => x.t);
  return ordered;
}
