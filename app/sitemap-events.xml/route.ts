// Event URLs sitemap (child of /sitemap.xml). Crawl-budget-aware: only the
// soonest instances of each recurring series, within a rolling horizon, with
// honest per-event <lastmod>. See lib/sitemap.ts for the why + the pure logic.
import { getUpcomingEventSlugRows } from "@/lib/events-data";
import {
  selectSitemapEvents,
  eventToSitemapUrl,
  renderUrlset,
  type SitemapUrl,
} from "@/lib/sitemap";

export const revalidate = 3600;

export async function GET() {
  const todayISO = new Date().toISOString().slice(0, 10);

  let urls: SitemapUrl[] = [];
  try {
    const rows = await getUpcomingEventSlugRows();
    urls = selectSitemapEvents(rows, { todayISO }).map(eventToSitemapUrl);
  } catch {
    // Supabase not configured — empty event sitemap; the index stays valid.
    urls = [];
  }

  return new Response(renderUrlset(urls), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
