// Facebook PAGE events — the per-page config shape and its activation gate.
//
// Sibling of fb-town-config.ts, and deliberately dependency-free for the same
// reason: the gate is the dangerous part, so it must be unit-testable without
// dragging the Apify transport in behind it.
//
// Why a second Facebook events source at all, when hwy4-fb-discover already
// reads the same actor? Because a town's /events/explore/ feed and a venue's
// own /events tab return DIFFERENT Facebook event objects, and measurably so.
// Copperopolis Town Square, probed 2026-09-05:
//
//   explore/copperopolis-ca  09-13  id 769764202448727   "Copperopolis Summer Concert series"
//   TheTownSquareAtCV/events 09-13  id 1801994517316530  "Music In The Square- The Yacht Rockers"
//
// Same night, same venue, two distinct event ids — the venue creates a generic
// series listing AND a named-act listing, and explore surfaces only the former.
// The page tab is where the act name lives, and the act name is what feeds the
// artists chip, the artist-blurb queue and the HWY-7 title work. (The two rows
// converge downstream on their own: isGenericTitle already reads "Copperopolis
// Summer Concert series" as a placeholder, so isSameEvent merges them at the
// same venue and placeholderNameSteal keeps the specific name. No new dedup.)

export interface FacebookPageConfig {
  /** org_slug column value (e.g. "fb-page-copperopolis-town-square"). */
  orgSlug: string;
  /** Display label — source_name suffix, and the venue fallback for a
   *  multi-venue page. */
  label: string;
  /** Town assumed when Facebook's own location text names no corridor town. */
  defaultTown: string;
  /** The page URL WITHOUT a trailing "/events" — that suffix is appended by
   *  eventsTabUrl, so a config carrying it would build ".../events/events". */
  pageUrl: string;
  /** Canonical venue name for a SINGLE-venue page, used only when Facebook
   *  supplies no location at all. Omit for a multi-venue source (a group, a
   *  chamber of commerce), where the honest fallback is "<label> Community"
   *  and asserting one venue would be a guess. */
  defaultVenue?: string;
}

const FB_HOSTS = new Set(["facebook.com", "www.facebook.com"]);

/**
 * A page is live once its URL is a usable, non-global Facebook page path.
 *
 * The strictness is the same lesson isConfiguredTown encodes: the failure mode
 * of a malformed entry is not "no events", it is "somebody else's events". A
 * bare https://www.facebook.com/ resolves to the global feed, and an entry that
 * already points at /events/explore/... belongs in fb-town-config — scraped
 * from here it would re-ingest a whole town under a single page's org_slug and
 * quietly attribute it to that venue.
 */
export function isConfiguredPage(config: {
  pageUrl?: string;
  orgSlug?: string;
  label?: string;
  defaultTown?: string;
}): boolean {
  if (!config.orgSlug?.trim()) return false;
  if (!config.label?.trim()) return false;
  if (!config.defaultTown?.trim()) return false;

  const raw = (config.pageUrl ?? "").trim();
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!FB_HOSTS.has(url.hostname.toLowerCase())) return false;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false; // the global feed

  // "events" anywhere means this is an explore/search/event URL, not a page.
  if (segments.some((s) => s.toLowerCase() === "events")) return false;

  // A group needs its own slug: "/groups" alone is the group directory.
  if (segments[0].toLowerCase() === "groups" && segments.length < 2) return false;

  return true;
}

/**
 * Build the /events tab URL the Apify actor is pointed at.
 * Only call this on a config that passed isConfiguredPage.
 */
export function eventsTabUrl(config: FacebookPageConfig): string {
  return `${config.pageUrl.trim().replace(/\/+$/, "")}/events`;
}
