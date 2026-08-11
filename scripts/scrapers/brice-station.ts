import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { runOrganizerSource } from "../lib/organizer-source.js";
import { classifyEventCategory } from "../../lib/categorize.js";
import { htmlToText } from "../lib/tribe.js";
import {
  fetchShopifyProducts,
  parseShopifyEventTitle,
  productImage,
  productPrice,
  type ShopifyProduct,
} from "../lib/shopify-events.js";

/**
 * Brice Station Vineyards — the venue's own ticket store, read structurally.
 *
 * WHY THIS SCRAPER EXISTS (2026-07-26). Brice was previously a generic
 * Firecrawl + LLM source, and the model got the data wrong twice in two days:
 * it wrote a row dated 2026-07-26 for the July 25 Wolf Jett show (a duplicate
 * advertising a concert that had already happened), and mis-set another show's
 * time. Brice runs Shopify and sells each concert as a ticket product, so the
 * date and time were sitting in structured fields the whole time — the venue
 * types them into the product title and Shopify derives the permalink handle
 * from it. Reading `/collections/events/products.json` removes the model from a
 * job that needs no judgment.
 *
 * The JSON feed is also strictly MORE complete than the rendered collection
 * page: the HTML lists 4 shows, the JSON returns 7 (sold-out and further-out
 * products drop out of the rendered grid).
 *
 * Deliberately NOT added to `scripts/lib/manual-sources.ts`. Unlike Arnold Rim
 * Trail, whose own feed is complete, this store only carries shows it is
 * actively selling tickets for — GoCalaveras legitimately covers Brice events
 * that have no ticket product yet, and blocklisting it would LOSE those. Both
 * sources coexist; this one runs after the aggregators so it is the last writer
 * on the rows it does cover. As a second guard, `correctFromUrl` in the shared
 * upsert pre-pass cross-checks every row against the date/time in its own
 * `event_url`, which for both sources is the Brice product permalink.
 *
 * Everything around the parsing (venue detection, the ownership-aware
 * blocklist, the future filter, the upsert, the summary) is the shared
 * `scripts/lib/organizer-source.ts` skeleton. No stale sweep: the store lists
 * only what it is actively selling, so a product leaving the collection means
 * "tickets closed", not "show cancelled".
 */

const COLLECTION_URL = "https://bricestation.com/collections/events";
const PRODUCT_BASE = "https://bricestation.com/products";
const PAGE_URL = "https://bricestation.com/collections/events";
const SOURCE_NAME = "Brice Station";
const ORG_SLUG = "brice-station";
const VENUE = "Brice Station Vineyards";
const TOWN = "Murphys";

function mapProduct(p: ShopifyProduct): ExtractedEvent | null {
  const parsed = parseShopifyEventTitle(p.title);
  // No parseable date means it is not an event we can place on a calendar
  // (merch, a gift card, a season pass). Drop it rather than guess.
  if (!parsed) return null;

  const description = p.body_html ? htmlToText(p.body_html) || null : null;

  return {
    name: parsed.name,
    description,
    date: parsed.date,
    start_time: parsed.startTime,
    // The store states a start but never an end; leave it unknown rather than
    // inventing a duration (never-guess, same as extract-prices).
    end_time: null,
    venue_name: VENUE,
    town: TOWN,
    address: null, // filled from the venue registry by normalizeEventLocation
    category: classifyEventCategory(`${parsed.name} ${description ?? ""} live music concert`),
    price: productPrice(p),
    artists: [parsed.name],
    event_url: `${PRODUCT_BASE}/${p.handle}`,
    image_url: productImage(p),
    // Shopify product id — stable across title/date/price edits, so a
    // rescheduled show updates in place instead of duplicating.
    source_event_id: String(p.id),
  };
}

export async function scrapeBriceStation(): Promise<void> {
  await runOrganizerSource({
    sourceName: SOURCE_NAME,
    orgSlug: ORG_SLUG,
    pageUrl: PAGE_URL,
    banner: "Brice Station (Shopify products.json)",
    async harvest() {
      const products = await fetchShopifyProducts(COLLECTION_URL);
      console.log(`\nFetched ${products.length} product(s) from the events collection`);

      const mapped: ExtractedEvent[] = [];
      for (const p of products) {
        try {
          const m = mapProduct(p);
          if (m) mapped.push(decodeEventFields(m));
          else console.log(`  skipped (no date in title): "${p.title}"`);
        } catch (err) {
          console.warn(`  Failed to map product ${p.id} ("${p.title}"):`, err);
        }
      }

      return {
        batches: [{ events: mapped }],
        context: undefined,
        summaryLines: [
          `Products fetched: ${products.length}`,
          `Mapped to events: ${mapped.length}`,
        ],
      };
    },
  });
}
