// Sitemap index (the URL submitted to Search Console + referenced by robots.ts).
// Points at two child sitemaps: the core/evergreen money pages and the
// crawl-budget-trimmed event pages. Splitting them lets Google prioritize the
// small high-value file and lets GSC report indexing coverage per-section.
//
// Implemented as a route handler (not app/sitemap.ts) so /sitemap.xml can return
// a <sitemapindex> — Next's metadata sitemap convention only emits a flat <urlset>.
import { SITE_URL } from "@/lib/constants";
import { renderSitemapIndex } from "@/lib/sitemap";

export const revalidate = 3600;

export async function GET() {
  const xml = renderSitemapIndex([
    { loc: `${SITE_URL}/sitemap-core.xml` },
    { loc: `${SITE_URL}/sitemap-events.xml` },
  ]);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
