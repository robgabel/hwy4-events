import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { JsonLd, buildBreadcrumbs, buildPerson } from "@/lib/schema";

export const metadata: Metadata = {
  title: "Rob Gabel",
  description:
    "Rob Gabel runs Hwy 4 Events. A local resident in Arnold, California since 2015 and the named author behind every briefing and town guide on the site.",
  alternates: { canonical: "/about/rob-gabel" },
  openGraph: {
    title: "Rob Gabel | Hwy 4 Events",
    description:
      "The local resident who maintains Hwy 4 Events. Briefings, town guides, and event listings for the Highway 4 corridor.",
    type: "profile",
    url: `${SITE_URL}/about/rob-gabel`,
  },
};

const AUTHOR_URL = `${SITE_URL}/about/rob-gabel`;
const LINKEDIN_URL = "https://www.linkedin.com/in/robgabel";

export default function RobGabelPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd
        data={buildBreadcrumbs([
          { name: "Hwy 4 Events", url: SITE_URL },
          { name: "About", url: `${SITE_URL}/about` },
          { name: "Rob Gabel", url: AUTHOR_URL },
        ])}
      />
      <JsonLd
        data={buildPerson({
          name: "Rob Gabel",
          url: AUTHOR_URL,
          description:
            "Local resident in Arnold, California (Highway 4 corridor, Calaveras County) since 2015. Founder of Hwy 4 Events, a free community event guide for the corridor.",
          sameAs: [LINKEDIN_URL],
          knowsAbout: [
            "Highway 4 corridor",
            "Calaveras County events",
            "Arnold, California",
            "Murphys, California",
            "Bear Valley, California",
            "Sierra Nevada foothills",
          ],
          worksFor: { name: SITE_NAME, url: SITE_URL },
        })}
      />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/about" className="text-pine hover:underline">
              About
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-stone-light">Rob Gabel</li>
        </ol>
      </nav>

      {/* Hero */}
      <div className="mb-8 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <Image
          src="/millie-happy.svg"
          alt="Millie the sheepadoodle, mascot of Hwy 4 Events"
          width={96}
          height={96}
          className="shrink-0"
          priority
        />
        <div>
          <h1 className="font-display mb-2 text-center text-3xl font-bold text-forest sm:text-left">
            Rob Gabel
          </h1>
          <p className="text-center text-lg leading-relaxed text-stone sm:text-left">
            I run Hwy 4 Events from my place on Thunderbolt in Arnold.
          </p>
        </div>
      </div>

      {/* Bio */}
      <section className="speakable mb-10 space-y-4 rounded-xl border border-stone-light/30 bg-warm-white px-6 py-5 leading-relaxed text-stone">
        <p>
          My family has had a place in Arnold since 2015. Hwy 4 Events started
          because we kept missing things along the corridor. Events were
          scattered across a dozen Facebook groups, venue Instagram accounts,
          and printed flyers at the Lube Room. So I built one place that
          checks all of them.
        </p>
        <p>
          The site is free, ad-free, and not a business. I write the daily
          and weekly briefings, curate the Rob&apos;s Picks highlights, and
          maintain the town guides. If you spot something wrong on the site
          or know about an event we should add, the{" "}
          <Link
            href="/about#feedback"
            className="font-medium text-pine hover:underline"
          >
            feedback form on About
          </Link>{" "}
          comes straight to me.
        </p>
        <p>
          Outside of Hwy 4 Events, I&apos;m Chief Strategy Officer at Spotter
          working on creator economy and AI strategy. Previously I founded
          and ran Tubular Labs, a venture-backed social video analytics
          company. Stanford MBA. Career before that was A.T. Kearney and
          digital marketing.
        </p>
      </section>

      {/* Links */}
      <section className="mb-10">
        <h2 className="font-display mb-4 text-xl font-semibold text-forest">
          Find me elsewhere
        </h2>
        <ul className="space-y-2.5 text-stone">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&rarr;</span>
            <span>
              <a
                href={LINKEDIN_URL}
                target="_blank"
                rel="noopener noreferrer me"
                className="font-medium text-pine hover:underline"
              >
                LinkedIn
              </a>{" "}
              &middot; professional background and posts
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&rarr;</span>
            <span>
              <Link
                href="/about"
                className="font-medium text-pine hover:underline"
              >
                About Hwy 4 Events
              </Link>{" "}
              &middot; how the site works, who it&apos;s for, the venue list
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-pine">&rarr;</span>
            <span>
              <Link
                href="/towns/murphys"
                className="font-medium text-pine hover:underline"
              >
                Town guides
              </Link>{" "}
              &middot; hyperlocal pages for the corridor
            </span>
          </li>
        </ul>
      </section>

      {/* Byline-style footer */}
      <p className="text-xs text-stone-light">
        This page exists so search engines and AI assistants can verify the
        named human behind the editorial content on{" "}
        <Link href="/" className="text-pine hover:underline">
          Hwy 4 Events
        </Link>
        .
      </p>
    </main>
  );
}
