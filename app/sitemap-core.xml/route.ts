// Core/evergreen sitemap (child of /sitemap.xml): the money pages — homepage,
// temporal aggregators, published town pages, and static pages. These are what
// we most want Google to crawl and index; isolating them in their own sitemap
// lets GSC report their coverage separately from the long tail of event pages.
import { SITE_URL } from "@/lib/constants";
import { getPublishedTownSlugs } from "@/app/towns/town-content";
import { TEMPORAL_CONFIG } from "@/lib/date-windows";
import { renderUrlset, type SitemapUrl } from "@/lib/sitemap";

export const revalidate = 3600;

export async function GET() {
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
