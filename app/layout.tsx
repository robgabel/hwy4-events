import type { Metadata } from "next";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  SITE_OG_DESCRIPTION,
} from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Sierra Nevada Foothills`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: `${SITE_NAME} | Sierra Nevada Foothills`,
    description: SITE_OG_DESCRIPTION,
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_US",
    images: [
      {
        url: "/og",
        width: 1200,
        height: 630,
        alt: "Hwy 4 Events — Sierra Nevada Foothills event listings",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Sierra Nevada Foothills`,
    description: SITE_OG_DESCRIPTION,
    images: ["/og"],
  },
};

function WebSiteSchema() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function OrganizationSchema() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "Community event listings for the Highway 4 corridor in the California Sierra Nevada foothills.",
    areaServed: {
      "@type": "Place",
      name: "Highway 4 Corridor, Calaveras County, California",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream antialiased">
        <WebSiteSchema />
        <OrganizationSchema />
        {children}
        <footer className="border-t border-stone-light/50 bg-warm-white py-10 text-center">
          <div className="mx-auto max-w-5xl px-4">
            <svg
              className="mx-auto h-6 w-6 text-sage opacity-40"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2L6 10h3l-4 8h5v4h4v-4h5l-4-8h3L12 2z" />
            </svg>

            <p className="mt-3 text-sm text-stone">
              Events along the Highway 4 corridor
              <br />
              from Angels Camp to Bear Valley.
            </p>

            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-stone-light/40 bg-white px-4 py-2 text-sm shadow-sm">
              <svg
                className="h-4 w-4 text-pine"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span className="text-stone">Know about an event?</span>
              <a
                href="mailto:hwy4events@example.com?subject=Event%20Submission"
                className="font-medium text-pine hover:underline"
              >
                Submit it here
              </a>
            </div>

            <p className="mt-5 text-xs text-stone-light">
              Data refreshed daily. Not all events may be listed.
            </p>
            <nav className="mt-3 flex justify-center gap-4 text-xs text-stone-light">
              <a href="/about" className="hover:text-pine hover:underline">
                About the Hwy 4 Corridor
              </a>
              <a href="/faq" className="hover:text-pine hover:underline">
                FAQ
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
