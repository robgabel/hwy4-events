/**
 * Warm the static-map edge cache and bust the stale geocode cache.
 *
 * Runs against the DEPLOYED site (the /api/static-map route and the geocode
 * cache live there), so run it AFTER a deploy and after any venue/address
 * backfill:
 *
 *   npm run warm-maps                                  # prod
 *   SITE_URL=… REVALIDATION_SECRET=… npm run warm-maps
 *
 * What it does:
 *   1. Bust  — calls /api/revalidate?tag=geocode so event pages re-geocode with
 *      the latest addresses (needs REVALIDATION_SECRET; skipped with a warning
 *      if unset).
 *   2. Warm  — fetches each upcoming event page (which server-geocodes + caches),
 *      scrapes the `/api/static-map?…` URL the page actually renders, and
 *      requests each distinct one so the first real visitor gets a cache hit
 *      instead of a cold tile stitch.
 *
 * Deliberately decoupled from the Next app internals: it never imports the
 * geocode/address libs (those use the `@/` alias + Next's fetch extension and
 * don't resolve in a plain script). It just reads the page's own output.
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { generateEventSlug } from "../lib/slugs.js";

const SITE_URL = (process.env.SITE_URL || "https://hwy4events.com").replace(/\/$/, "");
const SECRET = process.env.REVALIDATION_SECRET;
const CONCURRENCY = 6;

interface Row {
  name: string;
  date: string;
  town: string;
}

const STATIC_MAP_RE = /\/api\/static-map\?[^"'\\\s]+/;

async function mapPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("name, date, town")
    .gte("date", today)
    .neq("status", "cancelled");
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];
  console.log(`Upcoming events: ${rows.length} (site: ${SITE_URL})`);

  // --- Bust: force pages to re-geocode with the latest addresses -------------
  if (SECRET) {
    try {
      const r = await fetch(`${SITE_URL}/api/revalidate?tag=geocode`, {
        headers: { authorization: `Bearer ${SECRET}` },
      });
      console.log(`Bust geocode tag: HTTP ${r.status}`);
    } catch (e) {
      console.warn("Bust failed:", (e as Error).message);
    }
  } else {
    console.warn("REVALIDATION_SECRET unset — skipping geocode bust (warm only).");
  }

  // --- Warm: fetch each page, scrape its static-map URL, request it ----------
  const slugs = [...new Set(rows.map((r) => generateEventSlug(r.name, r.date, r.town)))];
  const staticUrls = new Set<string>();
  let pageOk = 0;
  let pageFail = 0;

  await mapPool(slugs, async (slug) => {
    try {
      const res = await fetch(`${SITE_URL}/events/${slug}`);
      if (!res.ok) {
        pageFail++;
        return;
      }
      pageOk++;
      const html = await res.text();
      const m = html.match(STATIC_MAP_RE);
      if (m) staticUrls.add(m[0].replace(/&amp;/g, "&"));
    } catch {
      pageFail++;
    }
  });

  console.log(`Pages warmed: ${pageOk}/${slugs.length} (${pageFail} failed). Distinct maps: ${staticUrls.size}`);

  let mapOk = 0;
  let mapFail = 0;
  await mapPool([...staticUrls], async (path) => {
    try {
      const r = await fetch(`${SITE_URL}${path}`);
      if (r.ok) mapOk++;
      else mapFail++;
    } catch {
      mapFail++;
    }
  });

  console.log(`\nWarmed ${mapOk}/${staticUrls.size} static maps (${mapFail} failed).`);
}

main().catch((err) => {
  console.error("warm-map-cache failed:", err);
  process.exit(1);
});
