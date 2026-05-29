/**
 * Reusable JSON-LD builders. Centralized so new pages don't reinvent schema
 * shapes and so changes (e.g. tweaking Event for a new property) ripple to
 * every page that uses them.
 *
 * Each builder returns a plain object; render with <JsonLd data={...} />.
 */

import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/constants";
import { Hwy4Event } from "@/lib/types";
import { generateEventSlug } from "@/lib/slugs";
import { resolveDisplayAddress } from "@/lib/address";
import { TownInfo } from "@/lib/towns";

// ----- shared component -----

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
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
    description:
      "Daily event briefing and listings for the Highway 4 corridor, from Angels Camp to Bear Valley in the California Sierra Nevada.",
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/millie-happy.svg`,
    },
    areaServed: {
      "@type": "Place",
      name: "Highway 4 Corridor, Calaveras County, California",
    },
    founder: {
      "@type": "Person",
      name: "Rob Gabel",
      url: `${SITE_URL}/about/rob-gabel`,
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
        url: `${SITE_URL}/millie-happy.svg`,
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
  dateModified: string;
  primaryImage?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: opts.url,
    name: opts.name,
    ...(opts.description && { description: opts.description }),
    dateModified: opts.dateModified,
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
  if (event.cost_tier === "free") {
    return {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
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
        availability: "https://schema.org/InStock",
        url,
      };
    }
  }
  return null;
}

export function buildEvent(event: Hwy4Event, slug?: string) {
  const eventSlug =
    slug ?? generateEventSlug(event.name, event.date, event.town);
  const displayAddress = resolveDisplayAddress(event.address, event.town);
  const offer = buildEventOffer(
    event,
    event.event_url || `${SITE_URL}/events/${eventSlug}`
  );

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
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
        addressRegion: "CA",
        addressCountry: "US",
      },
    },
    ...(offer && { offers: offer }),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus:
      event.status === "tentative"
        ? "https://schema.org/EventPostponed"
        : "https://schema.org/EventScheduled",
    ...(event.artists &&
      event.artists.length > 0 && {
        performer: event.artists.map((artist) => ({
          "@type": "Person",
          name: artist,
        })),
      }),
    organizer: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

export function buildItemList(events: Hwy4Event[], opts?: {
  name?: string;
  description?: string;
  limit?: number;
}) {
  const limit = opts?.limit ?? 50;
  const publicEvents = events.filter((e) => e.visibility === "public");

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: opts?.name ?? "Upcoming Events Along Highway 4",
    description:
      opts?.description ??
      "Today's events and this week's lineup along the Highway 4 corridor in the Sierra Nevada foothills.",
    numberOfItems: publicEvents.length,
    itemListElement: publicEvents.slice(0, limit).map((event, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_URL}/events/${generateEventSlug(
        event.name,
        event.date,
        event.town
      )}`,
      item: buildEvent(event),
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
    name: `${town.name}, California`,
    description: town.tagline,
    url: `${SITE_URL}/towns/${slug}`,
    address: {
      "@type": "PostalAddress",
      addressLocality: town.name,
      addressRegion: "CA",
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: town.lat,
      longitude: town.lng,
      elevation: `${town.elevation} ft`,
    },
    isPartOf: {
      "@type": "Place",
      name: "Highway 4 Corridor, Calaveras County, California",
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
