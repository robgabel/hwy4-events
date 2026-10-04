/**
 * Reusable JSON-LD builders. Centralized so new pages don't reinvent schema
 * shapes and so changes (e.g. tweaking Event for a new property) ripple to
 * every page that uses them.
 *
 * Each builder returns a plain object; render with <JsonLd data={...} />.
 */

// Relative (not "@/") imports so the scripts/ test runner, which doesn't load
// the app's tsconfig path alias, can import this module directly.
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "./constants";
import { Hwy4Event } from "./types";
import { generateEventSlug } from "./slugs";
import { resolveDisplayAddress } from "./address";
import { TownInfo } from "./towns";
import { serializeJsonLd } from "./json-ld";
import { REGION } from "./region";
import { REGION_OPS } from "./region-ops";
import { buildPerformers, type PublicArtist } from "./artists";
import { posterImageUrl } from "./poster";
import { isUnstableHost } from "./event-link";
import { isHttpUrl } from "./url";

// ----- shared component -----

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

// ----- site-level -----

export function buildWebSite() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function buildOrganization() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description: REGION_OPS.schemaOrg.orgDescription,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}${REGION_OPS.schemaOrg.logoPath}`,
    },
    areaServed: {
      "@type": "Place",
      name: REGION_OPS.schemaOrg.areaServed,
    },
    founder: {
      "@type": "Person",
      name: REGION_OPS.schemaOrg.founderName,
      url: `${SITE_URL}${REGION_OPS.schemaOrg.founderPath}`,
    },
  };
}

// ----- people -----

/**
 * Person schema for the named-author entity. Used on /about/rob-gabel and
 * cited as the author of editorial content (briefings, town pages).
 * sameAs links to verifiable public profiles for entity disambiguation.
 */
export function buildPerson(opts: {
  name: string;
  url: string;
  description: string;
  image?: string;
  sameAs?: string[];
  knowsAbout?: string[];
  jobTitle?: string;
  worksFor?: { name: string; url?: string };
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: opts.name,
    url: opts.url,
    description: opts.description,
    ...(opts.image && { image: opts.image }),
    ...(opts.sameAs && opts.sameAs.length > 0 && { sameAs: opts.sameAs }),
    ...(opts.knowsAbout && { knowsAbout: opts.knowsAbout }),
    ...(opts.jobTitle && { jobTitle: opts.jobTitle }),
    ...(opts.worksFor && {
      worksFor: {
        "@type": "Organization",
        name: opts.worksFor.name,
        ...(opts.worksFor.url && { url: opts.worksFor.url }),
      },
    }),
  };
}

// ----- articles + web pages -----

/** Article schema for editorial content (briefings, future blog posts). */
export function buildArticle(opts: {
  headline: string;
  description?: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  authorName: string;
  authorUrl: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    ...(opts.description && { description: opts.description }),
    url: opts.url,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    author: {
      "@type": "Person",
      name: opts.authorName,
      url: opts.authorUrl,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}${REGION_OPS.schemaOrg.logoPath}`,
      },
    },
  };
}

/**
 * WebPage wrapper that carries dateModified. Use on town/category/venue
 * pages to expose freshness signal that AI engines preferentially cite.
 */
export function buildWebPage(opts: {
  url: string;
  name: string;
  description?: string;
  /** Omit when nothing on the page has a knowable modification date. Never
   *  pass `new Date()`: see lib/date-modified.ts. */
  dateModified?: string | null;
  primaryImage?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: opts.url,
    name: opts.name,
    ...(opts.description && { description: opts.description }),
    ...(opts.dateModified && { dateModified: opts.dateModified }),
    ...(opts.primaryImage && {
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: opts.primaryImage,
      },
    }),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

// ----- breadcrumbs -----

export type Crumb = { name: string; url: string };

export function buildBreadcrumbs(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

// ----- events -----

// Schema.org Offer requires a numeric price. Only emit one for events we can
// state a number for: free (0) or paid with a parseable amount. donation /
// varies / unknown omit offers entirely (the property is optional).
export function buildEventOffer(event: Hwy4Event, url: string) {
  // A sold-out event still has a real offer; it is just unavailable. Saying so
  // is more honest than dropping the offer, and search results render it.
  const availability = event.sold_out
    ? "https://schema.org/SoldOut"
    : "https://schema.org/InStock";
  if (event.cost_tier === "free") {
    return {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability,
      url,
    };
  }
  if (event.cost_tier === "paid" && event.price) {
    const match = event.price.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (match) {
      return {
        "@type": "Offer",
        price: match[0],
        priceCurrency: "USD",
        availability,
        url,
      };
    }
  }
  return null;
}

/** The organizer a page can PROVE: the org `matchOrgForEvent` resolved for
 *  the event. We organize none of these events, so the old hard-coded
 *  "Hwy 4 Events" organizer contradicted the organizer's own page, which is
 *  exactly the corroboration check an answer engine runs. Unknown = omitted. */
export type EventOrganizer = { name: string; url?: string | null };

export type BuildEventOptions = {
  /** Our canonical event slug; derived from the row when omitted. */
  slug?: string;
  /** Published artist rows (live music only) for MusicGroup performers. */
  artists?: PublicArtist[];
  /** The offer URL. Defaults to our own stable event page; the detail page
   *  passes the resolved organizer/venue link when it is durable. */
  offerUrl?: string;
  /** The matched organizer, or null/absent to omit the field. Never guessed. */
  organizer?: EventOrganizer | null;
};

/** Organizer node, or null when there is nothing we can stand behind. A name is
 *  required (no slug-as-name guessing); a url rides along only when it is a
 *  durable http(s) destination, never an aggregator permalink. */
export function buildEventOrganizer(org: EventOrganizer | null | undefined) {
  const name = org?.name?.trim();
  if (!name || name === SITE_NAME) return null;
  const url =
    org?.url && isHttpUrl(org.url) && !isUnstableHost(org.url) ? org.url : null;
  return {
    "@type": "Organization",
    name,
    ...(url && { url }),
  };
}

/** schema.org eventStatus for a row. `tentative` means "not yet confirmed",
 *  not "the date moved", so it is never EventPostponed. */
export function eventStatusUrl(status: Hwy4Event["status"] | null | undefined): string {
  return status === "cancelled"
    ? "https://schema.org/EventCancelled"
    : "https://schema.org/EventScheduled";
}

/**
 * The one Event builder. The detail page and every ItemList call this, so the
 * shape cannot drift between them again (the detail page used to carry its own
 * inline copy that hard-coded "CA").
 */
export function buildEvent(event: Hwy4Event, opts: BuildEventOptions = {}) {
  const eventSlug =
    opts.slug ?? generateEventSlug(event.name, event.date, event.town);
  const pageUrl = `${SITE_URL}/events/${eventSlug}`;
  const displayAddress = resolveDisplayAddress(event.address, event.town);
  // Offer URL points at our own stable event page, never the scraped
  // `event_url` (which for aggregator sources is a churning permalink). The
  // detail page passes a resolved organizer/venue URL when it has one.
  const offer = buildEventOffer(event, opts.offerUrl ?? pageUrl);
  const performers = buildPerformers(
    event.artists,
    event.category === "live_music" ? opts.artists ?? [] : []
  );
  const organizer = buildEventOrganizer(opts.organizer);

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    url: pageUrl,
    image: posterImageUrl(event, eventSlug),
    ...(event.description && { description: event.description }),
    startDate: event.start_time
      ? `${event.date}T${event.start_time}`
      : event.date,
    ...(event.end_time && { endDate: `${event.date}T${event.end_time}` }),
    location: {
      "@type": "Place",
      name: event.venue_name,
      address: {
        "@type": "PostalAddress",
        ...(displayAddress && { streetAddress: displayAddress }),
        addressLocality: event.town,
        addressRegion: REGION.stateCode,
        addressCountry: REGION.countryCode,
      },
    },
    ...(offer && { offers: offer }),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: eventStatusUrl(event.status),
    ...(performers && { performer: performers }),
    ...(organizer && { organizer }),
  };
}

export function buildItemList(events: Hwy4Event[], opts?: {
  name?: string;
  description?: string;
  limit?: number;
  artists?: PublicArtist[];
}) {
  const limit = opts?.limit ?? 50;
  const publicEvents = events.filter((e) => e.visibility === "public");
  const artists = opts?.artists ?? [];

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: opts?.name ?? REGION_OPS.schemaOrg.itemListName,
    description: opts?.description ?? REGION_OPS.schemaOrg.itemListDescription,
    numberOfItems: publicEvents.length,
    itemListElement: publicEvents.slice(0, limit).map((event, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_URL}/events/${generateEventSlug(
        event.name,
        event.date,
        event.town
      )}`,
      item: buildEvent(event, { artists }),
    })),
  };
}

// ----- places -----

/**
 * TouristAttraction for town landing pages. Lighter than LocalBusiness.
 * We're claiming the page is a guide to a place, not that we operate there.
 */
export function buildTouristAttraction(town: TownInfo, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "TouristAttraction",
    name: `${town.name}, ${REGION.stateName}`,
    description: town.tagline,
    url: `${SITE_URL}/towns/${slug}`,
    address: {
      "@type": "PostalAddress",
      addressLocality: town.name,
      addressRegion: REGION.stateCode,
      addressCountry: REGION.countryCode,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: town.lat,
      longitude: town.lng,
      elevation: `${town.elevation} ft`,
    },
    isPartOf: {
      "@type": "Place",
      name: REGION_OPS.schemaOrg.areaServed,
    },
  };
}

// ----- FAQ -----

export type FaqEntry = { question: string; answer: string };

export function buildFaqPage(entries: FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: e.answer,
      },
    })),
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: [".speakable"],
    },
  };
}
