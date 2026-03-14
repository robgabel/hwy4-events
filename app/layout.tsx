import type { Metadata } from "next";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  SITE_OG_DESCRIPTION,
} from "@/lib/constants";
import LastChecked from "@/components/LastChecked";
import Image from "next/image";
import { Suspense } from "react";
import { Bitter, DM_Sans } from "next/font/google";
import "./globals.css";

const bitter = Bitter({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

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
        alt: "Hwy 4 Events — Today's events and this week along the Highway 4 corridor",
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
      "Daily event briefing and listings for the Highway 4 corridor — Angels Camp to Bear Valley in the California Sierra Nevada.",
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
    <html lang="en" className={`${bitter.variable} ${dmSans.variable}`}>
      <body className="min-h-screen bg-cream font-sans antialiased">
        <WebSiteSchema />
        <OrganizationSchema />
        {children}
        <footer className="border-t border-stone-light/50 bg-warm-white py-10 text-center">
          <div className="mx-auto max-w-5xl px-4">
            <Image
              src="/millie-lying.svg"
              alt=""
              width={40}
              height={24}
              className="mx-auto opacity-30"
            />

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
                href="mailto:rob@gabel.ai?subject=Event%20Submission"
                className="font-medium text-pine hover:underline"
              >
                Submit it here
              </a>
            </div>

            <Suspense
              fallback={
                <p className="mt-5 text-xs text-stone-light">
                  Updated regularly. Not all events may be listed.
                </p>
              }
            >
              <LastChecked />
            </Suspense>
            <nav className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-stone-light">
              <a href="/about" className="hover:text-pine hover:underline">
                About the Hwy 4 Corridor
              </a>
              <a href="/faq" className="hover:text-pine hover:underline">
                FAQ
              </a>
              <a href="/terms" className="hover:text-pine hover:underline">
                Terms
              </a>
              <a href="/privacy" className="hover:text-pine hover:underline">
                Privacy
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
