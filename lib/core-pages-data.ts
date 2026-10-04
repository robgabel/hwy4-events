// Server-side inputs for lib/core-pages.ts: the dynamic families (published
// town pages, sitemap-gated venue hubs). Shared by /sitemap-core.xml and
// /llms.txt so both advertise exactly the same pages (HWY-63).
import { getPublishedTownSlugs, getTownContent } from "@/app/towns/town-content";
import { getUpcomingEvents } from "@/lib/events-data";
import { getSupabase } from "@/lib/supabase";
import { sitemapVenueKeys } from "@/lib/venue-pages";
import type { CorePageInput } from "@/lib/core-pages";

// Venue hub pages (/venues/[key], HWY-9): advertise only venues with enough
// upcoming public events (lib/venue-pages.ts) so we never point crawlers at a
// thin page. Reads the shared cached event feed + the small hwy4_venues list;
// degrades to an empty list on any read error.
async function getAdvertisedVenues(): Promise<CorePageInput["venues"]> {
  try {
    const [{ data }, events] = await Promise.all([
      getSupabase().from("hwy4_venues").select("venue_key, canonical"),
      getUpcomingEvents(),
    ]);
    const rows = (data ?? []) as { venue_key: string; canonical: string | null }[];
    const keep = new Set(sitemapVenueKeys(rows.map((v) => v.venue_key), events));
    return rows
      .filter((v) => keep.has(v.venue_key))
      .map((v) => ({ slug: v.venue_key, name: v.canonical?.trim() || v.venue_key }));
  } catch {
    return [];
  }
}

export async function getCorePageInput(): Promise<CorePageInput> {
  const towns = getPublishedTownSlugs().map((slug) => {
    const content = getTownContent(slug);
    return { slug, name: content?.townName ?? slug, description: content?.metaDescription ?? null };
  });
  return { towns, venues: await getAdvertisedVenues() };
}
