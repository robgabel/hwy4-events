import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveEventLinkFromOrgs,
  promotableVenueUrl,
  isMultiTenantVenue,
  type LinkOrg,
} from "@/lib/event-link";

// The "actionable link gaps" computation, extracted from /api/check-events so the
// audit AND the agent cockpit's create_org_row proposer share ONE definition and
// can't drift. A gap = a single-operator venue with >= GAP_VENUE_THRESHOLD upcoming
// events whose best link is only the non-durable GoCalaveras fallback — each is
// worth one hwy4_orgs row (a durable canonical link). Multi-tenant venues (parks,
// community centers) are excluded: they have no single canonical events page, so
// the aggregator fallback is their correct terminal state.

export const GAP_VENUE_THRESHOLD = 5;

export type LinkGapVenue = {
  venue: string;
  count: number;
  town: string | null;
  sampleEventName: string | null;
};

export type LinkGapReport = {
  // Raw count of events using the non-durable aggregator fallback (trend signal).
  rawFallbackCount: number;
  // Single-operator venues at/above the threshold — the worklist.
  actionable: LinkGapVenue[];
};

type GapEventRow = {
  name: string;
  description: string | null;
  venue_name: string | null;
  venue_key: string | null;
  town: string | null;
  org_slug: string | null;
  event_url: string | null;
  status: string | null;
};

const GAP_EVENT_COLUMNS =
  "name, description, venue_name, venue_key, town, org_slug, event_url, status, date";

export async function computeActionableLinkGaps(
  supabase: SupabaseClient,
  events?: GapEventRow[]
): Promise<LinkGapReport> {
  // Reuse the caller's already-fetched future events when given (the audit), else
  // fetch our own (the proposer).
  let rows = events;
  if (!rows) {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("hwy4_events")
      .select(GAP_EVENT_COLUMNS)
      .gte("date", today);
    rows = (data ?? []) as GapEventRow[];
  }

  const { data: linkOrgs } = await supabase
    .from("hwy4_orgs")
    .select("slug, display_name, canonical_url, match_patterns")
    .not("canonical_url", "is", null);
  const orgs = (linkOrgs ?? []) as LinkOrg[];

  // Registry venue websites feed the resolver's "venue canonical" path (#2), so we
  // must see them too — otherwise we over-report single-operator venues the detail
  // page already resolves to a durable venue link. Keyed by venue_key, same as the page.
  const { data: venueRows } = await supabase
    .from("hwy4_venues")
    .select("venue_key, canonical, website")
    .not("website", "is", null);
  const venueByKey = new Map(
    (venueRows ?? []).map((v) => [
      v.venue_key as string,
      v as { canonical: string | null; website: string | null },
    ])
  );

  const agg = new Map<string, { count: number; town: string | null; sampleEventName: string | null }>();
  let rawFallbackCount = 0;
  for (const r of rows) {
    if (r.status === "cancelled" || !r.event_url) continue;
    const venue = r.venue_key ? venueByKey.get(r.venue_key) : undefined;
    const link = resolveEventLinkFromOrgs(
      {
        name: r.name,
        description: r.description,
        venue_name: r.venue_name ?? "",
        org_slug: r.org_slug,
        event_url: r.event_url,
      },
      orgs,
      { venueUrl: promotableVenueUrl(venue?.canonical, venue?.website) }
    );
    // Events with no link at all (community / no source) are correctly buttonless
    // and excluded; only the non-durable fallback is an upgrade opportunity.
    if (link.kind === "none" || link.durable) continue;
    rawFallbackCount++;
    const key = r.venue_name?.trim() || "(no venue)";
    const cur = agg.get(key) ?? { count: 0, town: r.town, sampleEventName: r.name };
    cur.count++;
    if (!cur.town && r.town) cur.town = r.town;
    agg.set(key, cur);
  }

  const actionable = [...agg.entries()]
    .filter(([venue, v]) => v.count >= GAP_VENUE_THRESHOLD && !isMultiTenantVenue(venue))
    .map(([venue, v]) => ({ venue, count: v.count, town: v.town, sampleEventName: v.sampleEventName }))
    .sort((a, b) => b.count - a.count);

  return { rawFallbackCount, actionable };
}
