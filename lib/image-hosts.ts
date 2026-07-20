// Which image srcs next/image may render, vs. which must fall back to a plain
// <img>. next/image validates an absolute src's host against next.config.ts
// `remotePatterns` *during render* and THROWS on an unconfigured host — which
// 500s every page that renders the card (homepage, town pages, temporal views),
// since one bad image takes down the whole render. So we only send srcs we KNOW
// next/image accepts through <Image>, and render everything else with a plain
// <img> (no allowlist, can't crash).
//
// OPTIMIZED_IMAGE_HOSTS MUST stay a subset of next.config.ts `remotePatterns`:
// a host listed here but NOT there would crash; a host there but not here merely
// skips optimization. scripts/test/image-hosts.test.ts enforces the subset
// against next.config.ts so the two can't drift into a crash.
import { REGION } from "./region";

export const OPTIMIZED_IMAGE_HOSTS: ReadonlySet<string> = new Set(
  REGION.imageHosts
);

/**
 * Can next/image safely render this src, or must it fall back to a plain <img>?
 * Local "/asset" paths and the allowlisted https hosts are safe; everything else
 * (external organizer images like ironstonevineyards.com, any future scrape
 * source, http://, or an unparseable string) routes to <img> so an unconfigured
 * host can never throw and 500 the page.
 */
export function canOptimizeImage(src: string): boolean {
  if (src.startsWith("/")) return true; // local asset (category art, /posters/*)
  try {
    const url = new URL(src);
    return url.protocol === "https:" && OPTIMIZED_IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false; // unparseable src → plain <img>, never crash the render
  }
}
