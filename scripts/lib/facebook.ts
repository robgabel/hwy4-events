import axios from "axios";
import { extractEvents, type VenueContext, type ExtractedEvent } from "./extract.js";

/** Track Facebook scraper outcomes per page across a single scrape run. */
const fbStatus: Record<string, { failed: boolean; error?: string }> = {};

/**
 * Returns a summary of which Facebook pages failed during this scrape run.
 * Used by the health check to detect persistent Facebook breakage.
 */
export function getFacebookStatus(): Record<string, { failed: boolean; error?: string }> {
  return { ...fbStatus };
}

/**
 * Same headers used by facebook-event-scraper — needed to get full page content
 * from Facebook's noscript renderer.
 */
const FB_HEADERS = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-encoding": "gzip, deflate, br",
  "accept-language": "en-US,en;q=0.6",
  "cache-control": "max-age=0",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "sec-gpc": "1",
  "upgrade-insecure-requests": "1",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

/**
 * Strip HTML tags and collapse whitespace to produce readable text.
 * Preserves newlines between block elements for better LLM parsing.
 */
function htmlToText(html: string): string {
  return (
    html
      // Add newlines before block elements so content doesn't run together
      .replace(/<\/(div|p|li|h[1-6]|article|section|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Remove all remaining HTML tags
      .replace(/<[^>]+>/g, " ")
      // Decode common HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#8211;/g, "–")
      .replace(/&#8212;/g, "—")
      .replace(/&#\d+;/g, "")
      // Collapse whitespace
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim()
  );
}

/**
 * Fetch a Facebook Page's feed as text and extract events using the LLM.
 *
 * This works for pages that post events as regular posts ("created an event")
 * or in Featured sections, rather than using Facebook's formal Events system.
 *
 * @param pageUrl - Facebook page URL (e.g. "https://www.facebook.com/mysticsaloon")
 * @param venue  - Default venue context
 * @returns Array of extracted events, or empty array on failure
 */
export async function fetchFacebookEvents(
  pageUrl: string,
  venue: VenueContext
): Promise<ExtractedEvent[]> {
  // Normalize URL: strip trailing slash, append noscript param
  const normalizedUrl = pageUrl.replace(/\/+$/, "");
  const fetchUrl = `${normalizedUrl}?_fb_noscript=1`;
  console.log(`  Fetching Facebook feed from: ${fetchUrl}`);

  let html: string;
  try {
    const response = await axios.get(fetchUrl, {
      headers: FB_HEADERS,
      timeout: 15000,
    });
    html = response.data;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.warn(`  Facebook fetch failed: ${errorMsg}`);
    fbStatus[pageUrl] = { failed: true, error: errorMsg };
    return [];
  }

  if (typeof html !== "string" || html.length < 500) {
    console.warn(`  Facebook returned insufficient content (${typeof html === "string" ? html.length : 0} chars)`);
    fbStatus[pageUrl] = { failed: true, error: "Insufficient content returned" };
    return [];
  }

  console.log(`  Received ${html.length} chars of HTML`);

  // Convert HTML to readable text for LLM extraction
  const text = htmlToText(html);

  if (text.length < 100) {
    console.warn(`  Extracted text too short after HTML stripping (${text.length} chars)`);
    fbStatus[pageUrl] = { failed: true, error: "Text content too short after parsing" };
    return [];
  }

  // Truncate to ~15k chars to stay within LLM context limits
  const truncated = text.slice(0, 15000);
  console.log(`  Extracted ${text.length} chars of text (using first ${truncated.length})`);

  const currentYear = new Date().getFullYear();

  try {
    const events = await extractEvents(
      "Facebook Page Events",
      normalizedUrl,
      truncated,
      currentYear,
      venue
    );

    fbStatus[pageUrl] = { failed: false };
    console.log(`  Extracted ${events.length} events from Facebook feed`);
    return events;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.warn(`  LLM extraction from Facebook content failed: ${errorMsg}`);
    fbStatus[pageUrl] = { failed: true, error: `LLM extraction failed: ${errorMsg}` };
    return [];
  }
}
