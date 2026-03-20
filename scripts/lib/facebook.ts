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

/** Headers mimicking a basic mobile browser. */
const FB_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

/**
 * Strip HTML tags and collapse whitespace to produce readable text.
 * Preserves newlines between block elements for better LLM parsing.
 */
function htmlToText(html: string): string {
  return (
    html
      // Add newlines before block elements so content doesn't run together
      .replace(/<\/(div|p|li|h[1-6]|article|section|tr|span)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Remove script and style blocks entirely
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
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
 * Extract the page slug from a Facebook URL.
 * e.g. "https://www.facebook.com/mysticsaloon/" -> "mysticsaloon"
 */
function getPageSlug(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() || "";
}

/**
 * Fetch a Facebook Page's feed as text and extract events using the LLM.
 *
 * Uses mbasic.facebook.com which serves server-rendered HTML with actual
 * post content (unlike www.facebook.com which requires JavaScript).
 *
 * @param pageUrl - Facebook page URL (e.g. "https://www.facebook.com/mysticsaloon")
 * @param venue  - Default venue context
 * @returns Array of extracted events, or empty array on failure
 */
export async function fetchFacebookEvents(
  pageUrl: string,
  venue: VenueContext
): Promise<ExtractedEvent[]> {
  const slug = getPageSlug(pageUrl);
  if (!slug) {
    console.warn(`  Could not extract page slug from: ${pageUrl}`);
    fbStatus[pageUrl] = { failed: true, error: "Invalid page URL" };
    return [];
  }

  // Use mbasic.facebook.com — serves actual HTML content without JavaScript
  const mbasicUrl = `https://mbasic.facebook.com/${slug}`;
  console.log(`  Fetching Facebook feed from: ${mbasicUrl}`);

  let html: string;
  try {
    const response = await axios.get(mbasicUrl, {
      headers: FB_HEADERS,
      timeout: 15000,
      // Follow redirects (Facebook may redirect)
      maxRedirects: 3,
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

  // Log a preview so we can see what the LLM is working with
  console.log(`  Text preview (first 500 chars):\n${text.slice(0, 500)}`);

  // Truncate to ~15k chars to stay within LLM context limits
  const truncated = text.slice(0, 15000);
  console.log(`  Extracted ${text.length} chars of text (using first ${truncated.length})`);

  const currentYear = new Date().getFullYear();

  try {
    const events = await extractEvents(
      "Facebook Page Events",
      pageUrl,
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
