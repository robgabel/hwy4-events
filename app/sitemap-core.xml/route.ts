// Core/evergreen sitemap (child of /sitemap.xml): the money pages — homepage,
// temporal aggregators, published town pages, and static pages. These are what
// we most want Google to crawl and index; isolating them in their own sitemap
// lets GSC report their coverage separately from the long tail of event pages.
import { SITE_URL } from "@/lib/constants";
import { getPublishedTownSlugs } from "@/app/towns/town-content";
import { TEMPORAL_CONFIG } from "@/lib/date-windows";
import { INTENT_CONFIG } from "@/lib/intent-pages";
import { HOLIDAY_GUIDES } from "@/lib/holiday-pages";
import { MARKET_GUIDES } from "@/lib/market-pages";
import { renderUrlset, type SitemapUrl } from "@/lib/sitemap";
import { getUpcomingEvents } from "@/lib/events-data";
import { getSupabase } from "@/lib/supabase";
import { sitemapVenueKeys } from "@/lib/venue-pages";

export const revalidate = 3600;

// Venue hub pages (/venues/[key], HWY-9): advertise only venues with enough
// upcoming public events (lib/venue-pages.ts) so we never point crawlers at a
// thin page. Reads the shared cached event feed + the small hwy4_venues key
// list; degrades to an empty list on any read error.
async function getSitemapVenueSlugs(): Promise<string[]> {
  try {
    const [{ data }, events] = await Promise.all([
      getSupabase().from("hwy4_venues").select("venue_key"),
      getUpcomingEvents(),
    ]);
    const keys = ((data ?? []) as { venue_key: string }[]).map((v) => v.venue_key);
    return sitemapVenueKeys(keys, events);
  } catch {
    return [];
  }
}

export async function GET() {
  const venueSlugs = await getSitemapVenueSlugs();
  // Home / temporal / town pages re-render with live event data daily, so a
  // today <lastmod> is honest. Truly static pages omit it (no real signal).
  const todayISO = new Date().toISOString().slice(0, 10);

  const urls: SitemapUrl[] = [
    { loc: SITE_URL, lastmod: todayISO, changefreq: "daily", priority: 1 },
    ...Object.values(TEMPORAL_CONFIG).map((cfg) => ({
      loc: `${SITE_URL}${cfg.path}`,
      lastmod: todayISO,
      changefreq: "daily" as const,
      priority: 0.9,
    })),
    ...getPublishedTownSlugs().map((slug) => ({
      loc: `${SITE_URL}/towns/${slug}`,
      lastmod: todayISO,
      changefreq: "weekly" as const,
      priority: 0.9,
    })),
    // Intent landing pages (visitor search: "things to do near …"). Live
    // calendar data, so a daily lastmod is honest.
    ...Object.values(INTENT_CONFIG).map((cfg) => ({
      loc: `${SITE_URL}${cfg.path}`,
      lastmod: todayISO,
      changefreq: "daily" as const,
      priority: 0.8,
    })),
    // Evergreen holiday guides (HWY-6): year-less URLs that inherit each
    // year's expired July-4th event pages via lib/seasonal-redirects.ts.
    ...HOLIDAY_GUIDES.map((g) => ({
      loc: `${SITE_URL}${g.path}`,
      lastmod: todayISO,
      changefreq: "weekly" as const,
      priority: 0.8,
    })),
    // Evergreen farmers-market guides (HWY-31): year-less URLs that consolidate
    // the equity a weekly market's dated event-instance pages kept splitting.
    ...MARKET_GUIDES.map((g) => ({
      loc: `${SITE_URL}${g.path}`,
      lastmod: todayISO,
      changefreq: "weekly" as const,
      priority: 0.8,
    })),
    // Seasonal festival landing page (HWY-3): live lineup data, daily lastmod.
    {
      loc: `${SITE_URL}/bear-valley-music-festival-2026`,
      lastmod: todayISO,
      changefreq: "daily",
      priority: 0.8,
    },
    // Venue hub pages (HWY-9): live event data, daily lastmod.
    ...venueSlugs.map((slug) => ({
      loc: `${SITE_URL}/venues/${slug}`,
      lastmod: todayISO,
      changefreq: "daily" as const,
      priority: 0.7,
    })),
    { loc: `${SITE_URL}/about`, changefreq: "monthly", priority: 0.7 },
    { loc: `${SITE_URL}/about/rob-gabel`, changefreq: "yearly", priority: 0.5 },
    { loc: `${SITE_URL}/faq`, changefreq: "monthly", priority: 0.6 },
  ];

  return new Response(renderUrlset(urls), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
