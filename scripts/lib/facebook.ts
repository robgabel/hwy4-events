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

/** Headers mimicking a desktop browser. */
const FB_HEADERS = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "max-age=0",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
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
      // Remove script and style blocks entirely
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      // Add newlines before block elements so content doesn't run together
      .replace(/<\/(div|p|li|h[1-6]|article|section|tr|span)>/gi, "\n")
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
 * Extract the page slug from a Facebook URL.
 * e.g. "https://www.facebook.com/mysticsaloon/" -> "mysticsaloon"
 */
function getPageSlug(url: string): string {
  return url.replace(/\/+$/, "").split("/").pop() || "";
}

/**
 * Try multiple Facebook URL variants to fetch page content.
 * Facebook frequently changes which endpoints work without auth,
 * so we try several approaches.
 */
async function fetchFacebookHtml(slug: string): Promise<{ html: string; source: string } | null> {
  const attempts = [
    // 1. mbasic — lightweight HTML, most likely to have post content
    { url: `https://mbasic.facebook.com/${slug}`, label: "mbasic" },
    // 2. mobile site
    { url: `https://m.facebook.com/${slug}`, label: "mobile" },
    // 3. www with noscript
    { url: `https://www.facebook.com/${slug}?_fb_noscript=1`, label: "www-noscript" },
    // 4. www page posts (sometimes accessible)
    { url: `https://www.facebook.com/${slug}/posts/`, label: "www-posts" },
  ];

  for (const attempt of attempts) {
    console.log(`  Trying ${attempt.label}: ${attempt.url}`);
    try {
      const response = await axios.get(attempt.url, {
        headers: FB_HEADERS,
        timeout: 15000,
        maxRedirects: 3,
        // Don't throw on non-2xx so we can inspect the response
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        console.log(`    ${attempt.label}: HTTP ${response.status}, skipping`);
        continue;
      }

      const html = typeof response.data === "string" ? response.data : "";
      if (html.length < 1000) {
        console.log(`    ${attempt.label}: too short (${html.length} chars), skipping`);
        continue;
      }

      // Check if we got actual content or just CSS/JS boilerplate
      const text = htmlToText(html);
      const hasEventContent =
        text.includes("created an event") ||
        text.includes("Live Music") ||
        text.includes("event") ||
        // Check for date-like patterns (Mon, Tue, etc.)
        /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text);

      if (text.length < 200) {
        console.log(`    ${attempt.label}: text too short after stripping (${text.length} chars)`);
        continue;
      }

      if (!hasEventContent && text.length < 2000) {
        console.log(`    ${attempt.label}: no event-like content detected, skipping`);
        continue;
      }

      console.log(`    ${attempt.label}: OK (${html.length} chars HTML, ${text.length} chars text)`);
      return { html, source: attempt.label };
    } catch (err: any) {
      console.log(`    ${attempt.label}: ${err?.message || err}`);
    }
  }

  return null;
}

/**
 * Fetch a Facebook Page's feed as text and extract events using the LLM.
 *
 * Tries multiple Facebook URL variants (mbasic, mobile, www) to find
 * one that returns actual post content without requiring authentication.
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

  console.log(`  Scraping Facebook page: ${slug}`);
  const result = await fetchFacebookHtml(slug);

  if (!result) {
    console.warn(`  All Facebook fetch attempts failed for: ${slug}`);
    fbStatus[pageUrl] = { failed: true, error: "All fetch attempts failed" };
    return [];
  }

  const text = htmlToText(result.html);

  // Log a preview so we can see what the LLM is working with
  console.log(`  Text preview (first 500 chars):\n${text.slice(0, 500)}`);

  // Truncate to ~15k chars to stay within LLM context limits
  const truncated = text.slice(0, 15000);
  console.log(`  Using ${truncated.length} of ${text.length} chars for extraction`);

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
    console.log(`  Extracted ${events.length} events from Facebook feed (via ${result.source})`);
    return events;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.warn(`  LLM extraction from Facebook content failed: ${errorMsg}`);
    fbStatus[pageUrl] = { failed: true, error: `LLM extraction failed: ${errorMsg}` };
    return [];
  }
}
