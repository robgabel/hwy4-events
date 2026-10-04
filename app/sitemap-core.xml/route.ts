// Core/evergreen sitemap (child of /sitemap.xml): the money pages — homepage,
// temporal aggregators, published town pages, guides, venue hubs, and static
// pages. Isolating them in their own sitemap lets GSC report their coverage
// separately from the long tail of event pages. The page list lives in
// lib/core-pages.ts, which /llms.txt reads too, so the two cannot drift.
import { SITE_URL } from "@/lib/constants";
import { corePages } from "@/lib/core-pages";
import { getCorePageInput } from "@/lib/core-pages-data";
import { renderUrlset, type SitemapUrl } from "@/lib/sitemap";

export const revalidate = 3600;

export async function GET() {
  const pages = corePages(await getCorePageInput());
  // Pages that re-render with live event data get a today <lastmod>. Truly
  // static pages omit it (no real signal).
  const todayISO = new Date().toISOString().slice(0, 10);

  const urls: SitemapUrl[] = pages.map((p) => ({
    loc: p.path === "/" ? SITE_URL : `${SITE_URL}${p.path}`,
    ...(p.live && { lastmod: todayISO }),
    changefreq: p.changefreq,
    priority: p.priority,
  }));

  return new Response(renderUrlset(urls), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
