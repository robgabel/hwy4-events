import FirecrawlApp from "@mendable/firecrawl-js";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { runOrganizerSource } from "../lib/organizer-source.js";
import { classifyEventCategory } from "../../lib/categorize.js";
import { htmlToText } from "../lib/tribe.js";
import {
  extractEventDetailLinks,
  eventSlugFromUrl,
  humanizeEventSlug,
  parseWixEventPage,
} from "../lib/wix-events.js";
import { type SweepRow } from "../lib/stale-sweep.js";

/**
 * Murphys Irish Pub — the venue's own Wix events site, read structurally.
 *
 * WHY THIS SCRAPER EXISTS (2026-08-09). The pub was a generic Firecrawl + LLM
 * entry in firecrawl-sources.ts pointed at the site's homepage, whose events
 * widget exposes no absolute dates to a text scrape — so the model invented
 * them, re-emitting the lineup a few days forward on every run (rows landed on
 * Mondays/Tuesdays when the pub is closed, "Open Mic Night" drifted from its
 * real Wednesdays onto Saturdays, and three different acts stacked onto one
 * 6 PM slot). Each drifted copy was a fresh title+date dedup_key with no
 * source_event_id and no event_url: invisible to every dedup layer (different
 * dates are never compared), uncorrectable by correctFromUrl, and never
 * retracted. 36 of the venue's 50 upcoming rows were phantoms at cleanup.
 *
 * Same cure as Brice Station: read structure, not renderings. The homepage
 * links every event's own /event-details/<slug> page; each page carries
 * schema.org Event JSON-LD (name + startDate/endDate, venue-local offset) and
 * recurring occurrences additionally date their slug
 * (open-mic-night-2026-08-05-18-00). Parsing lives in the pure
 * scripts/lib/wix-events.ts (locked by scripts/test/wix-events.test.ts) and
 * FAILS CLOSED: a page with no unambiguous date yields no event, so a site
 * redesign degrades to zero coverage, never back to fiction.
 *
 * Deliberately NOT blocklisted in manual-sources.ts (same reasoning as
 * Brice): GoCalaveras legitimately lists pub events too (its weekly Open Mic
 * series rows are real and well-dated), and both writers converging on a row
 * is handled by the shared dedup. Registered LATE in SPECIAL_SCRAPERS so the
 * organizer is the final writer on rows both cover, and every row carries its
 * own permalink so correctFromUrl cross-checks dated slugs on every pass.
 *
 * Retraction: a window-scoped stale sweep (scripts/lib/stale-sweep.ts) — the
 * pub edits bookings, and an append-only ingest turns every edit into a
 * stranded ghost. The sweep only covers [today .. latest date in this batch],
 * only rows this source owns, never human-touched rows, and archives to
 * hwy4_events_removed_archive before deleting.
 *
 * The pipeline around the parsing (venue detection, the ownership-aware
 * blocklist, the future filter, the upsert, the sweep call, the summary) is
 * the shared scripts/lib/organizer-source.ts skeleton. This source's sweep
 * guards — presence counted from EVERY linked page including unparseable ones,
 * no sweep when the link list was truncated, no sweep below
 * MIN_EVENTS_FOR_SWEEP — stay here in planSweep, because they encode what a
 * healthy fetch of THIS site looks like.
 */

const LIST_URL = "https://www.murphysirishpubca.com/";
const SOURCE_NAME = "Murphys Irish Pub";
const ORG_SLUG = "murphys-irish-pub";
const VENUE = "Murphys Irish Pub";
const TOWN = "Murphys";
const ADDRESS = "415 Main St, Murphys, CA 95247";

const MAX_EVENT_PAGES = 40;
/** Below this many parsed events the list fetch is suspect — upsert only, no sweep. */
const MIN_EVENTS_FOR_SWEEP = 3;
const PAGE_FETCH_DELAY_MS = 250;
const UA = "Hwy4EventsBot/1.0 (+https://hwy4events.com)";

/** Both domains serve the same Wix site. */
const OWN_HOST = /(?:^|\/\/)(?:www\.)?(?:murphysirishpubca|goirishinmurphys)\.com\//i;

/** Not a bookable act — don't stamp the title into the artists chip. */
const NON_ACT = /open mic|karaoke|trivia|bingo|jam session|comedy night/i;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url: string, firecrawl: FirecrawlApp | null): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.length > 500) return text;
      console.warn(`  Thin response (${text.length} chars) for ${url}`);
    } else {
      console.warn(`  Plain fetch ${res.status} for ${url}`);
    }
  } catch (err) {
    console.warn(`  Plain fetch failed for ${url}:`, err instanceof Error ? err.message : err);
  }
  if (!firecrawl) return null;
  try {
    const result = await firecrawl.scrapeUrl(url, {
      formats: ["rawHtml"],
      waitFor: 4000,
      timeout: 45000,
      onlyMainContent: false,
    } as Parameters<typeof firecrawl.scrapeUrl>[1]);
    if (result.success) {
      const html =
        (result as { rawHtml?: string }).rawHtml ?? (result as { html?: string }).html ?? "";
      if (html.length > 500) return html;
    }
  } catch (err) {
    console.warn(`  Firecrawl fallback failed for ${url}:`, err);
  }
  return null;
}

/** What planSweep needs from the fetch stage: the full linked-page set. */
interface PubContext {
  /** Every /event-details/ link the homepage carried, before the page cap. */
  allLinks: string[];
}

export async function scrapeMurphysIrishPub(): Promise<void> {
  await runOrganizerSource<PubContext>({
    sourceName: SOURCE_NAME,
    orgSlug: ORG_SLUG,
    pageUrl: LIST_URL,
    banner: "Murphys Irish Pub (Wix event pages)",

    async harvest() {
      const apiKey = process.env.FIRECRAWL_API_KEY;
      const firecrawl = apiKey ? new FirecrawlApp({ apiKey }) : null;

      // 1. The homepage IS the events page (its <title> is "EVENTS"); we only
      //    take the per-event links from it, never dates.
      const listHtml = await fetchHtml(LIST_URL, firecrawl);
      if (!listHtml) {
        console.warn("No usable list page — nothing scraped, nothing swept.");
        return null;
      }
      const allLinks = extractEventDetailLinks(listHtml, LIST_URL);
      const links = allLinks.slice(0, MAX_EVENT_PAGES);
      console.log(
        `Found ${allLinks.length} event page link(s)` +
          (allLinks.length > links.length ? ` (fetching first ${links.length})` : "")
      );
      if (allLinks.length === 0) {
        console.warn(
          "0 event-details links — site shape changed? Nothing scraped, nothing swept."
        );
        return null;
      }

      // 2. Each event page → structured date or nothing.
      const mapped: ExtractedEvent[] = [];
      for (const link of links) {
        await sleep(PAGE_FETCH_DELAY_MS);
        const html = await fetchHtml(link, firecrawl);
        if (!html) {
          console.warn(`  skipped (unfetchable): ${link}`);
          continue;
        }
        const parsed = parseWixEventPage(html, link);
        if (!parsed) {
          console.warn(`  skipped (no unambiguous date): ${link}`);
          continue;
        }
        if (parsed.dateConflict) {
          console.warn(
            `  DATE CONFLICT on ${parsed.slug}: JSON-LD says ${parsed.date}, slug disagrees — using JSON-LD`
          );
        }
        const name = parsed.name?.trim() || humanizeEventSlug(parsed.slug);
        // The pub's calendar is its music calendar; the keyword classifier's
        // "other" (a bare band name carries no keyword) means live_music here.
        const keywordCategory = classifyEventCategory(name);
        mapped.push(
          decodeEventFields({
            name,
            description: parsed.description ? htmlToText(parsed.description) || null : null,
            date: parsed.date,
            start_time: parsed.startTime,
            end_time: parsed.endTime,
            venue_name: VENUE,
            town: TOWN,
            address: ADDRESS,
            category: keywordCategory === "other" ? "live_music" : keywordCategory,
            price: null,
            artists: NON_ACT.test(name) ? null : [name],
            event_url: link,
            image_url: parsed.imageUrl,
            // The Wix slug is stable across date/time edits on a one-off event and
            // unique per occurrence on recurring ones — a reschedule updates in
            // place instead of duplicating.
            source_event_id: `murphys-irish-pub|${parsed.slug}`,
            // A JSON-LD date is the page's LIVE data; the dated slug is frozen at
            // creation. Without this, correctFromUrl in the upsert pre-pass would
            // re-impose the stale slug date on every rescheduled occurrence.
            date_authoritative: parsed.dateSource === "jsonld",
          })
        );
      }

      return {
        batches: [{ events: mapped }],
        context: { allLinks },
        summaryLines: [`Event pages: ${links.length}, parsed: ${mapped.length}`],
      };
    },

    // 3. Retraction — see header. Only when the batch is healthy, only within
    //    the dates this batch provably covers. A truncated link list means the
    //    presence set and window are both untrustworthy — no sweep that run.
    planSweep({ today, context, written }) {
      const { allLinks } = context;
      if (allLinks.length > MAX_EVENT_PAGES) {
        console.log(
          `  Sweep skipped: link list truncated (${allLinks.length} > ${MAX_EVENT_PAGES}) — presence set incomplete this run.`
        );
        return null;
      }
      if (written.length < MIN_EVENTS_FOR_SWEEP) {
        if (written.length > 0) {
          console.log(
            `  Sweep skipped: only ${written.length} future event(s) parsed (< ${MIN_EVENTS_FOR_SWEEP}).`
          );
        }
        return null;
      }

      const maxDate = written.map((e) => e.date).sort().at(-1)!;
      const presentKeys = new Set<string>();
      // EVERY linked page counts as present — including ones that failed to
      // fetch or parse. Absence from the pub's calendar is the sweep criterion;
      // our inability to read a page that is still linked must never delete its
      // row.
      for (const link of allLinks) {
        const slug = eventSlugFromUrl(link);
        if (slug) presentKeys.add(slug);
      }
      for (const e of written) {
        if (e.source_event_id) presentKeys.add(e.source_event_id);
        const slug = e.event_url ? eventSlugFromUrl(e.event_url) : null;
        if (slug) presentKeys.add(slug);
      }

      return {
        reason: "murphys-irish-pub sweep (no longer on the pub's Wix calendar)",
        windows: [{ from: today, to: maxDate }],
        presentKeys,
        keysOf: (r: SweepRow) => [
          r.source_event_id,
          r.event_url ? eventSlugFromUrl(r.event_url) : null,
        ],
        // Only rows this source owns: our sid scheme, our host's permalinks, or
        // the old LLM era's key-less/link-less rows. A row carrying another
        // source's URL (e.g. a GoCalaveras permalink merged onto our org) is
        // that source's to manage.
        ownRow: (r: SweepRow) => {
          if (r.event_url) return OWN_HOST.test(r.event_url);
          return !r.source_event_id || r.source_event_id.startsWith("murphys-irish-pub|");
        },
      };
    },
  });
}
