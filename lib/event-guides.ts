import type { Hwy4Event } from "./types";

// Registry of seasonal festival "guide" landing pages and the internal links that
// point INTO them. A dedicated SEO landing page (e.g. /bear-valley-music-festival-2026)
// is an orphan the moment it ships: it links OUT to the calendar but nothing links
// IN except the sitemap (crawler-only). Internal links are a real ranking + crawl
// signal, so every guide must be reachable from a page users and crawlers already
// hit. This registry is the one place those inbound links are defined; a guide is
// surfaced from (a) the "Browse similar" chips on each matching event's detail page
// and (b) its town page, gated by `hideAfter` so a past year's page stops being
// linked once its festival is over (the page itself lives on for direct/search hits).
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

export type FestivalGuide = {
  path: string;
  label: string; // chip text on an event detail page
  heading: string; // town-page callout heading
  blurb: string; // town-page callout sub-line
  townSlug: string; // the town page that features it
  hideAfter: string; // YYYY-MM-DD (Pacific) — stop surfacing internal links after this
  matchEvent: (e: Pick<Hwy4Event, "venue_key" | "name">) => boolean;
};

export const FESTIVAL_GUIDES: FestivalGuide[] = [
  {
    path: "/bear-valley-music-festival-2026",
    label: "Festival guide",
    heading: "Planning for the Bear Valley Music Festival?",
    blurb: "Dates, the full lineup, and getting there, all in one place.",
    townSlug: "bear-valley",
    hideAfter: "2026-08-02", // the festival's closing day
    matchEvent: (e) =>
      e.venue_key === "big-white-tent" ||
      (e.name?.toLowerCase().includes("bear valley music festival") ?? false),
  },
];

function isLive(g: FestivalGuide, todayIso: string): boolean {
  return todayIso <= g.hideAfter;
}

/** The guide an event belongs to (for the event detail page's internal link), or null. */
export function festivalGuideForEvent(
  e: Pick<Hwy4Event, "venue_key" | "name">,
  todayIso: string
): FestivalGuide | null {
  return FESTIVAL_GUIDES.find((g) => isLive(g, todayIso) && g.matchEvent(e)) ?? null;
}

/** The guides a town page should feature (usually 0 or 1). */
export function festivalGuidesForTown(townSlug: string, todayIso: string): FestivalGuide[] {
  return FESTIVAL_GUIDES.filter((g) => isLive(g, todayIso) && g.townSlug === townSlug);
}
