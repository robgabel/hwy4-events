import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "Terms of use for Hwy 4 Events — a community event listing for the Highway 4 corridor in the California Sierra Nevada foothills.",
  alternates: { canonical: "/terms" },
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
        name: "Terms of Use",
        item: `${SITE_URL}/terms`,
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

export default function TermsPage() {
  return (
    <main>
      <BreadcrumbSchema />

      {/* Mountain header */}
      <div className="hero-gradient mountain-bg relative overflow-hidden">
        <div className="relative z-10 mx-auto max-w-3xl px-4 pb-16 pt-10 text-center">
          <svg
            className="mx-auto mb-3 h-8 w-8 text-sage-light opacity-70"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L6 10h3l-4 8h5v4h4v-4h5l-4-8h3L12 2z" />
          </svg>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Terms of Use
          </h1>
        </div>
        {/* Mini mountain silhouette */}
        <svg
          viewBox="0 0 800 60"
          className="absolute bottom-0 left-0 w-full text-cream"
          fill="currentColor"
          preserveAspectRatio="none"
        >
          <path d="M0,60 L0,35 L80,42 L160,28 L240,38 L320,20 L400,32 L480,18 L560,30 L640,22 L720,36 L800,25 L800,60 Z" />
        </svg>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="mb-8 text-sm text-stone">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="text-pine hover:underline">
                Hwy 4 Events
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-stone-light">Terms of Use</li>
          </ol>
        </nav>

        <div className="space-y-6 leading-relaxed text-stone">
          <p>
            Welcome to Hwy 4 Events! This is a personal project I built to help
            locals and visitors find events along the Highway 4 corridor. By
            using this site, you agree to these simple terms.
          </p>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Informational purposes only
            </h2>
            <p>
              Event details — dates, times, locations, prices — are gathered from
              public sources and may not always be accurate or up to date. Always
              confirm details with the event organizer before making plans. I do
              my best to keep things current, but I can&apos;t guarantee
              everything is 100% right.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              No warranties
            </h2>
            <p>
              This site is provided &ldquo;as is&rdquo; without any warranties
              of any kind. I&apos;m not responsible for any issues that arise
              from using the information on this site — like showing up to an
              event that got cancelled, or driving to a venue that moved
              locations.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Event content
            </h2>
            <p>
              Event names, descriptions, and details belong to their respective
              organizers and venues. Hwy 4 Events simply aggregates and displays
              this publicly available information to help the community.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Be cool
            </h2>
            <p>
              Please don&apos;t scrape, overload, or abuse this site. It&apos;s
              a community resource built with care. If you want event data for a
              project, just{" "}
              <a
                href="mailto:rob@gabel.ai"
                className="font-medium text-pine hover:underline"
              >
                reach out
              </a>{" "}
              and ask.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Changes to these terms
            </h2>
            <p>
              I may update these terms from time to time. Nothing dramatic — just
              keeping things honest and clear as the site evolves.
            </p>
          </section>

          <p className="text-sm text-stone-light">
            Last updated: March 2026
          </p>
        </div>

        <div className="mt-10 border-t border-stone-light/30 pt-6">
          <Link
            href="/"
            className="text-sm font-medium text-pine hover:underline"
          >
            &larr; Back to events
          </Link>
        </div>
      </div>
    </main>
  );
}
