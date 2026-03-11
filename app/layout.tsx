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
        <footer className="border-t border-stone-light/50 bg-warm-white py-8 text-center text-sm text-stone">
          <div className="mx-auto max-w-5xl px-4">
            <p>
              Events along the Highway 4 corridor from Angels Camp to Bear
              Valley.
            </p>
            <p className="mt-1 text-stone-light">
              Data refreshed daily. Not all events may be listed.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
