// HWY-58. Search Console ranks
// /events/ironstone-concours-delegance-2026-09-26-murphys for
// "ironstone concours 2026" with impressions and almost no clicks. The
// stored name is "Ironstone Concours d'Elegance" (no year). This page
// only adds the year to the H1 and a short factual Q&A.
//
// The public slug stays the stored name's slug. Feeding the new H1
// through generateEventSlug would mint a second URL
// (...-delegance-2026-2026-09-26-...), so the override is display-only.
//
// Facts are the event row and the Ironstone venue page. The listing
// states no ticket price (price empty, cost_tier unknown; the GoCalaveras
// source URL 404s), so there is no tickets item. Parking is the venue
// page's "free parking" line, not a concours-day rule.

export const IRONSTONE_CONCOURS_SLUG =
  "ironstone-concours-delegance-2026-09-26-murphys";

export const IRONSTONE_CONCOURS_EVENT_PATH =
  `/events/${IRONSTONE_CONCOURS_SLUG}`;

export const IRONSTONE_VENUE_PATH = "/venues/ironstone";

export const IRONSTONE_CONCOURS_H1 = "Ironstone Concours d'Elegance 2026";

export type IronstoneConcoursQa = {
  question: string;
  answer: string;
  /** Internal link rendered under the answer. Not part of the FAQ JSON-LD. */
  href?: string;
  linkLabel?: string;
};

export type IronstoneConcoursPage = {
  h1: string;
  qa: IronstoneConcoursQa[];
};

const QA: IronstoneConcoursQa[] = [
  {
    question: "When is Ironstone Concours d'Elegance 2026?",
    answer: "Saturday, September 26, 2026, from 9:00 AM to 4:00 PM.",
  },
  {
    question: "Where is Ironstone Concours d'Elegance 2026?",
    answer: "Ironstone Vineyards, 1894 Six Mile Road, Murphys CA 95247.",
    href: IRONSTONE_VENUE_PATH,
    linkLabel: "Ironstone Vineyards venue page",
  },
  {
    question: "Where do I park for Ironstone Concours d'Elegance?",
    answer: "Ironstone Vineyards has free parking.",
  },
];

export function ironstoneConcoursPage(
  slug: string,
): IronstoneConcoursPage | null {
  if (slug !== IRONSTONE_CONCOURS_SLUG) return null;
  return { h1: IRONSTONE_CONCOURS_H1, qa: QA };
}

export type IronstoneConcoursVenueLink = {
  href: string;
  heading: string;
  blurb: string;
};

/** Callout on /venues/ironstone. The concours date is past, so it is not
 *  in the venue's upcoming list and needs its own link. */
export function ironstoneConcoursVenueLink(
  venueKey: string,
): IronstoneConcoursVenueLink | null {
  if (venueKey !== "ironstone") return null;
  return {
    href: IRONSTONE_CONCOURS_EVENT_PATH,
    heading: IRONSTONE_CONCOURS_H1,
    blurb:
      "Saturday, September 26, 2026, from 9:00 AM to 4:00 PM at Ironstone Vineyards.",
  };
}
