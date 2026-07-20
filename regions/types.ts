// Region config type layer — the engine/instance contract.
//
// A "region" is one deployment of this engine (BUSINESS-PLAN §6: one repo →
// N deployments, config per region, one Supabase project per region). Every
// region-specific value the engine reads lives behind these interfaces; the
// engine itself never hardcodes a town, a domain, or a brand string. See
// docs/REGIONS.md for the full engine/instance boundary.
//
// RULES for this directory (load-bearing — the module is imported by client
// components, the edge OG route, and the scripts/ tsx runner):
//   - Pure data + types only. No runtime imports beyond sibling region files.
//   - Relative, extensionless imports only (no "@/", no "next/*", no node:*).
//   - One field per distinct string: two strings that differ by even one byte
//     get two fields. Never "unify" near-duplicates — that changes rendered
//     output, and this refactor's contract is byte-identical output.

/** Geographic data for one town on the corridor. */
export interface TownInfo {
  name: string;
  elevation: number; // feet
  tagline: string;
  lat: number;
  lng: number;
  /**
   * Default street address used when an event has no specific address.
   * Drives the map popup, directions URL, and structured data so the map
   * pin is useful rather than centered on a town centroid with no signal.
   * Optional — only set for towns where there's a sensible town-square anchor.
   */
  defaultAddress?: string;
  /**
   * Default zoom for the town's static map thumbnail and the interactive map's
   * town-centroid fallback. Defaults to 15 (neighborhood) for towns with a real
   * downtown; remote alpine hamlets whose centroid sits in forest use a wider
   * zoom (13) so there's road/context instead of a blank frame. The interactive
   * map still zooms to 15 once it geocodes an actual venue.
   */
  mapZoom?: number;
}

export interface RegionGeo {
  /** The region's towns, ordered the way locals describe the place (for the
   *  corridor: west to east, ascending elevation). Order is rendered. */
  towns: TownInfo[];
  /** Address-only town aliases — names that appear in scraped addresses but
   *  aren't canonical towns (e.g. Hathaway Pines is treated as Arnold). */
  townAddressAliases: readonly string[];
  /** Generous bounding box for the visitor-vs-local IP classifier (lib/geo.ts).
   *  Directional, not exact — see that module's header. */
  visitorBox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  /** Local city names (lowercased) matched against the IP city — the region's
   *  towns plus immediate neighbors that read as "local". */
  localIpCities: readonly string[];
  /** Center + radius (meters) used to bias Google Places Text Search when
   *  resolving venues (/api/sync-venue-facts). */
  placesBias: { lat: number; lng: number; radiusMeters: number };
}

/**
 * Client-safe region config: brand strings, geography, timezone. This layer
 * MAY be imported from client components and the edge runtime — keep it small
 * and free of anything you wouldn't ship in a public JS bundle.
 */
export interface RegionCore {
  /** Registry key + deployment identity (cron guards compare against this). */
  slug: string;

  // ----- identity / brand -----
  siteName: string;
  /** The site referred to AS a site ("Hwy4Events.com") — used in prose like
   *  "Back to Hwy4Events.com". Distinct from siteName and domain. */
  siteRef: string;
  /** Bare production hostname, e.g. "hwy4events.com". */
  domain: string;
  /** Production origin fallback when NEXT_PUBLIC_SITE_URL is unset. */
  defaultSiteUrl: string;
  /** Crawler/bot UA name (weather, watcher fetches): "Hwy4EventsBot". */
  botName: string;
  /** Title-template suffix: "Sierra Nevada Foothills". */
  titleSuffix: string;
  siteDescription: string;
  siteOgDescription: string;
  /** OG image alt on the default social card. */
  ogImageAlt: string;
  /** PWA manifest description (deliberately its own string — it differs from
   *  siteDescription byte-for-byte and must stay that way). */
  manifestDescription: string;
  headerTagline: string;
  /** Footer lede, rendered as two lines. */
  footerLede: readonly [string, string];
  /** Daily briefing card heading ("Today on the 4"). */
  briefingTitle: string;
  /** Curated-pick badge label ("Rob's Pick") + plural section label. */
  picksLabel: string;
  picksLabelPlural: string;
  /** PWA manifest theme colors. */
  theme: { backgroundColor: string; themeColor: string };
  mascot: {
    name: string;
    /** Image alt text — accessibility copy, so it's its own string. */
    imgAlt: string;
    /** Header/hero asset path under public/. */
    headerAsset: string;
  };
  /** Default OG card strings (app/og/route.tsx — edge runtime). */
  og: {
    kicker: string;
    townsLine: string;
    subline: string;
  };

  // ----- media / link trust -----
  /** Hosts next/image may optimize. MUST stay equal to next.config.ts
   *  remotePatterns (pinned by scripts/test/image-hosts.test.ts). */
  imageHosts: readonly string[];
  /** Aggregator hosts rendered as best-effort, non-durable source links
   *  (lib/event-link.ts). Bare hosts, no "www.". */
  unstableSourceHosts: readonly string[];
  /** host → friendly provenance label ("gocalaveras.com" → "GoCalaveras"). */
  sourceHostLabels: Readonly<Record<string, string>>;
  /** org_slug → friendly source label for card provenance chips. */
  sourceSlugLabels: Readonly<Record<string, string>>;

  // ----- geography / time -----
  /** ISO 3166-2 region code for schema.org + IP classification: "CA". */
  stateCode: string;
  /** Full state name for prose/schema place names: "California". */
  stateName: string;
  /** ISO country code: "US". */
  countryCode: string;
  /** IANA timezone the region's "today" is computed in. */
  timezone: string;
  geo: RegionGeo;
}

/**
 * Server/scripts-only region config: email addresses, prompt/persona atoms,
 * SEO plumbing. NEVER import this layer from a client component — it stays
 * out of public bundles by convention (there is exactly one accessor,
 * lib/region-ops.ts, which makes review easy).
 */
export interface RegionOps {
  emails: {
    /** Newsletter From address (env NEWSLETTER_FROM overrides). */
    newsletterFrom: string;
    /** Newsletter Reply-To (env NEWSLETTER_REPLY_TO overrides). */
    replyTo: string;
    /** The operator's own address: feedback To:, reader tip line. */
    owner: string;
    /** Contact address carried in polite fetch UAs (geocode, static maps). */
    hello: string;
  };
  userAgents: {
    /** Date-verification fetcher: "Hwy4Events-Verifier". */
    verifierName: string;
    /** QA-audit fetcher: "Hwy4EventsQA". */
    qaName: string;
  };
  seo: {
    /** GSC property fallback when GOOGLE_SEARCH_CONSOLE_SITE_URL is unset. */
    gscPropertyDefault: string;
  };
  schemaOrg: {
    orgDescription: string;
    areaServed: string;
    founderName: string;
    /** Site-relative path to the founder/author page. */
    founderPath: string;
    /** Site-relative logo path. */
    logoPath: string;
    itemListName: string;
    itemListDescription: string;
  };
  newsletter: {
    /** Subject line lede ("What's happening on the 4"). */
    subjectPrefix: string;
    /** Hero subline under the email masthead. */
    heroSubline: string;
    /** "Forward to a friend" mailto body lede (URL is appended). */
    forwardBodyLede: string;
    /** "Text it to someone" sms body lede (URL is appended). */
    smsBodyLede: string;
    /** Footer line after the domain link ("Angels Camp to Bear Valley, CA"). */
    footerSpan: string;
    assets: {
      tree: string;
      mascot: string;
      /** Alt text for the email mascot image. */
      mascotAlt: string;
    };
  };
  qaAudit: {
    /** Town slugs the weekly QA audit samples for page checks. */
    townSlugSample: readonly string[];
  };
}
