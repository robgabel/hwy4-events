import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getPublishedTownSlugs, getTownContent } from "@/app/towns/town-content";
import { TOWN_INFO } from "@/lib/towns";

export const metadata: Metadata = {
  title: "Page not found",
  description:
    "The page you were looking for isn't on Hwy 4 Events. Head back to the main event list, check this weekend's lineup, or browse a town.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  // Surface published town links so visitors who hit a stale URL have
  // somewhere useful to recover to.
  const townSlugs = getPublishedTownSlugs()
    .map((slug) => {
      const content = getTownContent(slug);
      const info = content ? TOWN_INFO[content.townName] : undefined;
      return { slug, name: content?.townName, elevation: info?.elevation ?? 0 };
    })
    .filter((t): t is { slug: string; name: string; elevation: number } => !!t.name)
    .sort((a, b) => a.elevation - b.elevation);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center px-4 py-16 text-center">
      <Image
        src="/millie-happy.svg"
        alt="Millie the sheepadoodle looking confused"
        width={120}
        height={120}
        className="opacity-40"
      />
      <h1 className="font-display mt-6 text-2xl font-bold text-forest">
        Millie can&apos;t find that page either
      </h1>
      <p className="mt-2 text-stone">
        It might have moved, or maybe it never existed.
        <br />
        Either way, the events are still happening.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-forest px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pine"
      >
        &larr; Back to all events
      </Link>

      {townSlugs.length > 0 && (
        <div className="mt-12 w-full rounded-xl border border-stone-light/30 bg-warm-white px-6 py-5">
          <p className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-forest">
            Or browse a town
          </p>
          <ul className="flex flex-wrap justify-center gap-2 text-sm">
            {townSlugs.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/towns/${t.slug}`}
                  className="rounded-full border border-stone-light/40 bg-white px-3 py-1 text-stone hover:border-pine/40 hover:text-pine"
                >
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-12 text-xs text-stone-light">
        Spot a broken link? Let me know via the{" "}
        <Link href="/about#feedback" className="text-pine hover:underline">
          feedback form
        </Link>
        .
      </p>
    </main>
  );
}
