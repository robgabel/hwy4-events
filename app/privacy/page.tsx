import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy policy for Hwy 4 Events — a community event listing for the Highway 4 corridor in the California Sierra Nevada foothills.",
  alternates: { canonical: "/privacy" },
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
        name: "Privacy Policy",
        item: `${SITE_URL}/privacy`,
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

export default function PrivacyPage() {
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
            Privacy Policy
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
            <li className="text-stone-light">Privacy Policy</li>
          </ol>
        </nav>

        <div className="space-y-6 leading-relaxed text-stone">
          <p>
            Hwy 4 Events is a simple, community-focused site. Your privacy
            matters, and the good news is: there&apos;s not much to worry about
            here.
          </p>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              No accounts, no tracking
            </h2>
            <p>
              This site has no user accounts, no login, and no sign-up. You
              don&apos;t need to give me any personal information to use it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Analytics
            </h2>
            <p>
              I use basic, privacy-friendly web analytics to understand how many
              people visit the site and which pages are popular. This data is
              aggregated and anonymous — I don&apos;t track individual visitors
              or build any profiles.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Cookies
            </h2>
            <p>
              This site uses only essential cookies needed for the site to
              function. No advertising cookies, no third-party trackers, no
              creepy stuff.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Your data is not for sale
            </h2>
            <p>
              I don&apos;t sell, share, or trade any data with third parties.
              Period.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-forest">
              Contact
            </h2>
            <p>
              If you have any questions about privacy on this site, feel free to{" "}
              <a
                href="mailto:rob@gabel.ai"
                className="font-medium text-pine hover:underline"
              >
                email me
              </a>
              .
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
