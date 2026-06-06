// The ONE definition of "where should this event's outbound link go."
//
// History: the UI used to link to `event_url` — *where the scraper found the
// event*. For ~69% of upcoming events that's a GoCalaveras (EventON/WordPress)
// permalink, and the original PRD suppressed those entirely on the belief they
// churn slugs and 404. Re-verified 2026-06-03 with browser-grade fetches: the
// current GoCalaveras permalinks (incl. the incrementing recurring slugs) return
// 200 with correct, current content. The 403 is only against *server-side*
// validators (our CI), not a real user's browser. So we now render a GoCalaveras
// link as a best-effort, NON-DURABLE source CTA rather than no button at all.
//
// resolveEventLink answers destination from event *identity*, in priority order:
//   1. organizer canonical  (hwy4_orgs.canonical_url, matched by slug or pattern)
//   2. venue canonical      (registry URL, caller-supplied)
//   3. stable-source link   (event_url from a durable host, e.g. visitmurphys.com)
//   4. aggregator fallback  (event_url from GoCalaveras — non-durable source link;
//                            excluded for community submissions)
//   5. none                 (community / no source — our own page is the destination)
//
// Primary source always wins: a GoCalaveras event that also matches an organizer
// or venue keeps linking to that organizer/venue, NOT to GoCalaveras.
//
// Defined here once and imported by every surface that links out (the event
// detail page, its JSON-LD, the patriotic detail layout) plus the org matcher
// reused by /api/verify-events — so "where does this link go" can't drift.
// Locked by scripts/test/event-link.test.ts.

/** Aggregator hosts we render as a best-effort CTA but never *trust*: their
 *  per-event permalinks 403 server-side validators and can churn slugs, so we
 *  keep them out of JSON-LD and out of validateEventUrls, and mark the resolved
 *  link non-durable. Rendered only when AGGREGATOR_FALLBACK is on (it is).
 *  Compared case-insensitively with and without a leading "www.". */
export const UNSTABLE_SOURCE_HOSTS: ReadonlySet<string> = new Set([
  "gocalaveras.com",
]);

/** When true: an event whose only link is an unstable-host `event_url`
 *  (GoCalaveras) renders that link as a non-durable source CTA instead of no
 *  button. Enabled 2026-06-03 after browser-grade fetches (Firecrawl) confirmed
 *  the current permalinks — including the incrementing recurring slugs the
 *  original PRD said churn — return 200 with correct, current content; the 403
 *  is only against server-side validators, not a real user's browser. Community
 *  submissions are still excluded (we're the source there). The link stays out
 *  of JSON-LD (durable:false) so a rare stale permalink can't leak into schema.
 *  See PRD-event-link-resolution.md (reversal note) + CLAUDE.md "Outbound Event Links". */
export const AGGREGATOR_FALLBACK = true;

export interface LinkOrg {
  slug: string;
  display_name?: string | null;
  canonical_url: string | null;
  match_patterns: string[] | null;
}

/** Minimal event shape the matcher reads. */
export interface OrgMatchEvent {
  name: string;
  description?: string | null;
  venue_name: string;
  org_slug: string | null;
}

/** Minimal event shape the resolver reads. */
export interface LinkEvent extends OrgMatchEvent {
  event_url: string | null;
  /** Community submissions never get the aggregator fallback — we are the source
   *  of record, so a bare submission stays buttonless rather than linking out to
   *  an aggregator. Organizer/venue/durable-source links still apply to them. */
  community_sourced?: boolean | null;
}

export type LinkKind = "organizer" | "venue" | "source" | "none";

export interface ResolvedLink {
  /** Destination href, or null when kind === 'none'. */
  href: string | null;
  /** Button label, e.g. "Visit Arnold Rim Trail" or "Visit Event Page". */
  label: string;
  kind: LinkKind;
  /** True when the destination is authoritative + durable (organizer/venue, or
   *  a stable-host source). False only when AGGREGATOR_FALLBACK surfaces an
   *  aggregator link. Consumers use this to keep non-durable links out of
   *  JSON-LD offer URLs and server-side validation. */
  durable: boolean;
}

const NONE: ResolvedLink = { href: null, label: "", kind: "none", durable: false };

/** Collapse whitespace + lowercase for forgiving substring matching. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Bare host without a leading "www.", or null if the URL can't be parsed. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True if the URL's host is a churning/bot-walled aggregator we mark non-durable
 *  and never server-validate (also true for an unparseable URL). */
export function isUnstableHost(url: string): boolean {
  const h = hostOf(url);
  if (!h) return true; // unparseable → don't trust it
  return UNSTABLE_SOURCE_HOSTS.has(h) || UNSTABLE_SOURCE_HOSTS.has(`www.${h}`);
}

/** Venues that host events from many independent organizers (parks, community
 *  centers, town squares, fairgrounds, amphitheaters). Their own website is a
 *  generic homepage, not an event page — a worse "more info" destination than the
 *  aggregator's per-event permalink, and a bare aggregator link is the correct
 *  terminal state for them. A multi-tenant name is also a useful "don't trust the
 *  auto-matched Places website" signal: Perry Walther Community Center matched a
 *  Bear Valley parents group, Utica Park matched a Facebook page. */
const MULTI_TENANT_VENUE =
  /\b(parks?|community center|town square|plaza|fairgrounds?|amphitheat(?:er|re))\b/i;

/** True for parks/community-centers/town-squares/etc. — venues where no single
 *  canonical events page exists, so the aggregator fallback is the right answer
 *  and a canonical org row is NOT actionable. Shared by the link resolver's
 *  callers and the /api/check-events link-gap audit so the page and the KPI
 *  agree on what counts as a real gap. */
export function isMultiTenantVenue(venueName: string | null | undefined): boolean {
  return !!venueName && MULTI_TENANT_VENUE.test(venueName);
}

const SOCIAL_HOSTS: ReadonlySet<string> = new Set([
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
]);

/** A venue website we're willing to promote to a durable CTA (resolver
 *  priority #2 — "venue canonical"). Null for multi-tenant venues, social pages
 *  (not event-specific), and missing/unparseable URLs. Callers pass the result
 *  straight into resolveEventLink's `venueUrl`, so the resolver stays pure and
 *  this trust gate lives in exactly one place. */
export function promotableVenueUrl(
  venueName: string | null | undefined,
  website: string | null | undefined
): string | null {
  if (!website) return null;
  if (isMultiTenantVenue(venueName)) return null;
  const h = hostOf(website);
  if (!h || SOCIAL_HOSTS.has(h)) return null;
  return website;
}

/**
 * Resolve an event to its organizer, given the org registry.
 *
 * A direct `org_slug` match wins ONLY when that org has a canonical
 * destination. The critical case: aggregator-sourced events carry
 * `org_slug='gocalaveras'`, and that aggregator row has no `canonical_url` — so
 * it must NOT short-circuit. Instead we fall through to `match_patterns`
 * against the event's name/description/venue to find the real organizer
 * (Arnold Rim Trail, Big Trees). Patterns match normalized, so enumerate
 * spelling variants in the data (the source really does list "Aronld Rim
 * Trail"). This is the single matcher; /api/verify-events imports it too.
 */
export function matchOrgForEvent<O extends LinkOrg>(
  ev: OrgMatchEvent,
  orgs: O[]
): O | null {
  if (ev.org_slug) {
    const direct = orgs.find((o) => o.slug === ev.org_slug);
    // An explicit slug pointing at a real organizer is authoritative. An
    // aggregator slug (no canonical) is not a destination — let patterns win.
    if (direct?.canonical_url) return direct;
  }
  const haystack = norm(`${ev.name} ${ev.description ?? ""} ${ev.venue_name}`);
  for (const o of orgs) {
    if (!o.match_patterns) continue;
    if (o.match_patterns.some((p) => haystack.includes(norm(p)))) return o;
  }
  return null;
}

/**
 * The destination resolver. Pure: callers supply the matched org and any venue
 * URL. Use resolveEventLinkFromOrgs when you have the full org registry.
 */
export function resolveEventLink(
  ev: LinkEvent,
  opts?: { org?: LinkOrg | null; venueUrl?: string | null; venueName?: string | null }
): ResolvedLink {
  // 1. Organizer canonical — the most authoritative, durable destination. A
  //    GoCalaveras event that matches an organizer keeps linking here, not to
  //    GoCalaveras (primary source wins).
  const org = opts?.org;
  if (org?.canonical_url) {
    return {
      href: org.canonical_url,
      label: `Visit ${org.display_name?.trim() || "event organizer"}`,
      kind: "organizer",
      durable: true,
    };
  }

  // 2. Venue canonical.
  if (opts?.venueUrl) {
    return {
      href: opts.venueUrl,
      label: `Visit ${opts.venueName?.trim() || ev.venue_name}`,
      kind: "venue",
      durable: true,
    };
  }

  // 3. Scraped per-event link — from a host we trust to be durable.
  if (ev.event_url) {
    if (!isUnstableHost(ev.event_url)) {
      return { href: ev.event_url, label: "Visit Event Page", kind: "source", durable: true };
    }
    // 3b. Unstable host (e.g. GoCalaveras): rendered as a best-effort, non-durable
    //     source link (live in-browser, 403s only server-side). Excluded for
    //     community submissions (we're the source of record there) and for
    //     unparseable junk (hostOf null) — only a real aggregator host renders.
    if (AGGREGATOR_FALLBACK && !ev.community_sourced && hostOf(ev.event_url)) {
      return { href: ev.event_url, label: "Visit Event Page", kind: "source", durable: false };
    }
  }

  // 4. No durable destination — the internal event page is the destination.
  return NONE;
}

/** Convenience: match the org from the registry, then resolve. */
export function resolveEventLinkFromOrgs(
  ev: LinkEvent,
  orgs: LinkOrg[],
  opts?: { venueUrl?: string | null; venueName?: string | null }
): ResolvedLink {
  return resolveEventLink(ev, { org: matchOrgForEvent(ev, orgs), ...opts });
}
