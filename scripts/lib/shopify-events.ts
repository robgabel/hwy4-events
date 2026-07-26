/**
 * Shopify "ticket product as event" reader.
 *
 * Several corridor venues sell concert tickets as Shopify products and have no
 * calendar at all — the product list IS the schedule. Shopify exposes every
 * storefront collection as clean JSON at
 * `/collections/<handle>/products.json`, which carries the title, permalink
 * handle, description, price, images, and a stable numeric id.
 *
 * Why this exists (2026-07-26): Brice Station was being read by the generic
 * Firecrawl + LLM runner, which produced two defects in two days — a row dated
 * 2026-07-26 for the July 25 Wolf Jett show (a duplicate advertising a concert
 * that had already happened), and a mis-set time on another. The date and time
 * were sitting in structured fields the whole time. Reading them directly
 * removes the model from a job that needs no judgment.
 *
 * The `products.json` feed is also strictly MORE complete than the rendered
 * collection page: the HTML shows 4 shows, the JSON returns 7 (sold-out and
 * further-out products are dropped from the rendered grid).
 *
 * Pure parsing lives here so `scripts/test/shopify-events.test.ts` can lock it
 * against real titles; the transport is a plain fetch with a Firecrawl fallback.
 */

import FirecrawlApp from "@mendable/firecrawl-js";
import { parseStatedTime } from "../../lib/verify-times.js";

// ---------- Response shape (only the fields we read) ----------

export interface ShopifyVariant {
  price?: string | null;
  available?: boolean;
}

export interface ShopifyImage {
  src?: string | null;
  position?: number;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html?: string | null;
  product_type?: string | null;
  published_at?: string | null;
  variants?: ShopifyVariant[];
  images?: ShopifyImage[];
}

export interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

// ---------- Title parsing ----------

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/**
 * These venues hand-type their product titles, so the shape wobbles: the
 * name/date separator is a hyphen OR an en/em dash, the time is introduced by
 * "@" OR another dash, whitespace doubles up, and a note can trail the time
 * ("~ Earlier Time!"). All four variants are live on Brice Station today.
 *
 * The name is non-greedy, so a band name containing a dash still parses — the
 * regex backtracks to the separator that is actually followed by a month.
 */
const TITLE_RE = new RegExp(
  String.raw`^(?<name>.*?)\s*[-–—]\s*(?<month>${MONTH_ALT})\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(?<year>20\d{2})` +
    String.raw`(?:\s*[@\-–—~]?\s*(?<time>\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?))?`,
  "i"
);

export interface ParsedEventTitle {
  /** The act / event name, with the date and time stripped off. */
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  /** "HH:MM" (24h), or null when the title states no time. */
  startTime: string | null;
}

/**
 * Pull the act, date, and start time out of a ticket product's title.
 * Returns null when the title carries no parseable date — the caller drops the
 * product rather than guessing, since a ticket product with no date is not an
 * event we can place on a calendar.
 */
export function parseShopifyEventTitle(
  title: string | null | undefined
): ParsedEventTitle | null {
  if (!title) return null;
  const m = TITLE_RE.exec(title.replace(/\s+/g, " ").trim());
  if (!m?.groups) return null;

  const month = MONTHS[m.groups.month.toLowerCase().replace(/\.$/, "")];
  const day = Number(m.groups.day);
  const year = Number(m.groups.year);
  if (!month) return null;

  // Reject a date that doesn't exist rather than letting Date roll it over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  const name = m.groups.name.trim().replace(/[\s–—-]+$/, "").trim();
  if (!name) return null;

  return {
    name,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    // Reuse the tested comparator's parser so "7pm" / "6:30 PM" resolve the
    // same way here as they do in time verification.
    startTime: parseStatedTime(m.groups.time ?? null),
  };
}

/** Lowest variant price as a display string ("$25.00"), or null. */
export function productPrice(p: ShopifyProduct): string | null {
  const prices = (p.variants ?? [])
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length === 0) return null;
  return `$${Math.min(...prices).toFixed(2)}`;
}

/** First image by position, or null. */
export function productImage(p: ShopifyProduct): string | null {
  const imgs = [...(p.images ?? [])].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );
  return imgs.find((i) => i.src)?.src ?? null;
}

// ---------- Transport ----------

/**
 * Fetch a storefront collection's products. Plain fetch first; falls back to
 * Firecrawl when the store bot-walls a server-side request, mirroring
 * `scripts/lib/tribe.ts` and `red-cross.ts`.
 */
export async function fetchShopifyProducts(
  collectionUrl: string,
  limit = 250
): Promise<ShopifyProduct[]> {
  const url = `${collectionUrl.replace(/\/$/, "")}/products.json?limit=${limit}`;

  const parse = (text: string): ShopifyProduct[] => {
    const data = JSON.parse(text) as ShopifyProductsResponse;
    if (!Array.isArray(data.products)) {
      throw new Error("products.json did not contain a products array");
    }
    return data.products;
  };

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Hwy4EventsScraper/1.0)",
        Accept: "application/json",
      },
    });
    if (res.ok) {
      return parse(await res.text());
    }
    console.warn(`  products.json direct fetch failed (${res.status}) — retrying via Firecrawl`);
  } catch (err) {
    console.warn(`  products.json direct fetch threw (${String(err)}) — retrying via Firecrawl`);
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("products.json blocked and FIRECRAWL_API_KEY is unset — no fallback available");
  }
  const firecrawl = new FirecrawlApp({ apiKey });
  const result = await firecrawl.scrapeUrl(url, {
    formats: ["rawHtml"],
    onlyMainContent: false,
    timeout: 30000,
  });
  if (!result.success || !result.rawHtml) {
    throw new Error("products.json: Firecrawl fallback also failed");
  }
  return parse(result.rawHtml);
}
