import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hwy 4 Events | Sierra Nevada Foothills",
  description:
    "Discover events along the Highway 4 corridor — Angels Camp, Murphys, Arnold, Bear Valley and beyond.",
  openGraph: {
    title: "Hwy 4 Events | Sierra Nevada Foothills",
    description:
      "Live music, festivals, and community events in the Calaveras County mountain corridor.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream antialiased">
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
          </div>
        </footer>
      </body>
    </html>
  );
}
