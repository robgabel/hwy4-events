import Link from "next/link";
import { Hwy4Event } from "@/lib/types";
import { isDateNightEvent, isFreeEvent } from "@/lib/intent-pages";
import { townSlug } from "@/lib/slugs";
import { getTownContent } from "@/app/towns/town-content";
import { festivalGuideForEvent } from "@/lib/event-guides";
import { holidayGuideForEvent } from "@/lib/holiday-pages";
import { marketGuideForEvent } from "@/lib/market-pages";
import { pacificToday } from "@/lib/date-windows";

/**
 * Contextual internal links from an event detail page into the browse
 * surfaces it belongs to (intent pages, this-weekend, the town page).
 * Cheap internal linking for the pages we most want crawled, and the
 * "what else is nearby" answer for a visitor who landed here from search.
 */
export default function BrowseSimilar({ event }: { event: Hwy4Event }) {
  const chips: { href: string; label: string }[] = [
    { href: "/this-weekend", label: "This weekend" },
  ];
  // A festival guide (e.g. the Bear Valley Music Festival page) leads the chips
  // for its own events: it's the most specific "what else" answer, and this is
  // the internal link that keeps that landing page from being an orphan.
  const guide = festivalGuideForEvent(event, pacificToday().iso);
  if (guide) chips.unshift({ href: guide.path, label: guide.label });
  // Events in the July holiday window link to their town's evergreen 4th of
  // July guide (the inbound link that keeps /arnold-4th-of-july etc. crawled).
  const holiday = holidayGuideForEvent(event);
  if (holiday) chips.unshift({ href: holiday.path, label: holiday.label });
  // A farmers-market instance links to its evergreen guide. This is the link
  // that consolidates the equity those dated instance pages were splitting
  // seven ways, and it keeps the guide crawled all season (HWY-31).
  const market = marketGuideForEvent(event);
  if (market) chips.unshift({ href: market.path, label: market.label });
  if (isFreeEvent(event)) chips.push({ href: "/free", label: "Free events" });
  if (isDateNightEvent(event)) {
    chips.push({ href: "/date-night", label: "Date night" });
  }
  chips.push({ href: "/things-to-do", label: "Things to do" });
  const slug = townSlug(event.town);
  if (getTownContent(slug)) {
    chips.push({ href: `/towns/${slug}`, label: `More in ${event.town}` });
  }

  return (
    <nav aria-label="Browse similar" className="mt-8">
      <h2 className="font-display mb-2 text-sm font-semibold uppercase tracking-wider text-stone">
        Browse similar
      </h2>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-full border border-stone-light/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest transition-colors hover:border-pine/30"
          >
            {c.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
