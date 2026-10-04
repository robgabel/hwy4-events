// /llms.txt (HWY-63): a plain-text map of the site for AI assistants. Generated
// from lib/core-pages.ts, the same registry /sitemap-core.xml reads, so a new
// guide or town page shows up here the day it ships instead of never.
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { corePages } from "@/lib/core-pages";
import { getCorePageInput } from "@/lib/core-pages-data";
import { renderLlmsTxt } from "@/lib/llms-txt";

export const revalidate = 3600;

export async function GET() {
  const body = renderLlmsTxt({
    siteName: SITE_NAME,
    siteUrl: SITE_URL,
    pages: corePages(await getCorePageInput()),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
