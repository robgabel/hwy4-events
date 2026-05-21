import { extractEvents, type VenueContext, type ExtractedEvent } from "./extract.js";
import { supabaseAdmin } from "./supabase-admin.js";
import { getApifyToken, runApifyActorSync } from "./apify-client.js";

/** Track Facebook scraper outcomes per page across a single scrape run. */
const fbStatus: Record<string, { failed: boolean; error?: string }> = {};

/**
 * Returns a summary of which Facebook pages failed during this scrape run.
 * Used by the health check to detect persistent Facebook breakage.
 */
export function getFacebookStatus(): Record<string, { failed: boolean; error?: string }> {
  return { ...fbStatus };
}

interface ApifyPostResult {
  text?: string;
  postText?: string;
  timestamp?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * Get the last scrape date for a given org_slug to avoid re-fetching old posts.
 * Returns a date string (YYYY-MM-DD) or null if never scraped.
 */
async function getLastScrapeDate(orgSlug: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("hwy4_events")
      .select("last_scraped_at")
      .eq("org_slug", orgSlug)
      .not("last_scraped_at", "is", null)
      .order("last_scraped_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.last_scraped_at) {
      return new Date(data.last_scraped_at).toISOString().slice(0, 10);
    }
  } catch {
    // Non-fatal — fall back to default window
  }
  return null;
}

/**
 * Fetch recent posts from a Facebook Page via Apify's Facebook Posts Scraper.
 *
 * Only fetches posts since the last scrape to minimize Apify costs.
 * First run: fetches last 14 days. Subsequent runs: only new posts.
 */
async function fetchApifyPosts(
  pageUrl: string,
  orgSlug: string,
  maxPosts: number = 20
): Promise<ApifyPostResult[]> {
  // Determine date window: since last scrape, or last 14 days for first run
  const lastScrape = await getLastScrapeDate(orgSlug);
  const dateFrom = lastScrape || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  })();

  console.log(`  Fetching posts since: ${dateFrom}${lastScrape ? " (last scrape)" : " (first run, 14-day window)"}`);

  return runApifyActorSync<ApifyPostResult>({
    actor: "apify~facebook-posts-scraper",
    input: {
      startUrls: [{ url: pageUrl }],
      resultsLimit: maxPosts,
      onlyPostsNewerThan: dateFrom,
    },
    timeoutMs: 120000,
  });
}

/**
 * Keywords that suggest a post is about an event rather than casual content.
 */
const EVENT_KEYWORDS = [
  "event", "created an event", "live music", "concert", "show",
  "comedy", "karaoke", "open mic", "dj", "band", "performing",
  "tickets", "cover charge", "doors open", "starts at",
  "this saturday", "this friday", "this sunday", "this weekend",
  "next saturday", "next friday", "next sunday",
  "pm", "am", // time indicators
  "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "january", "february",
  "feast", "celebration", "special", "happy hour",
  "food", "menu", "drink specials",
];

/**
 * Check if a post likely contains event information.
 */
function isEventLikePost(text: string): boolean {
  const lower = text.toLowerCase();
  // Must have at least 2 event keywords or be longer than 100 chars with 1 keyword
  const matchCount = EVENT_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  return matchCount >= 2 || (matchCount >= 1 && text.length > 100);
}

/**
 * Convert a Unix timestamp to a readable date string.
 */
function formatTimestamp(ts: string | number | undefined): string {
  if (!ts) return "unknown date";
  const num = typeof ts === "string" ? parseInt(ts, 10) : ts;
  if (isNaN(num) || num < 1000000000) return String(ts);
  return new Date(num * 1000).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Convert Apify post results into a text blob for LLM extraction.
 * Filters to event-like posts and formats timestamps as readable dates.
 */
function postsToText(posts: ApifyPostResult[]): string {
  const eventPosts = posts.filter((post) => {
    const text = post.text || post.postText || "";
    return text.trim().length > 0 && isEventLikePost(text);
  });

  console.log(`  Filtered to ${eventPosts.length} event-like posts (of ${posts.length} total)`);

  return eventPosts
    .map((post, i) => {
      const text = post.text || post.postText || "";
      const dateStr = formatTimestamp(post.timestamp);
      const url = post.url || "";
      return `--- Post ${i + 1} (posted ${dateStr}) ---\n${text}\n${url ? `Link: ${url}` : ""}`;
    })
    .join("\n\n");
}

/**
 * Fetch a Facebook Page's recent posts via Apify and extract events using the LLM.
 *
 * @param pageUrl - Facebook page URL (e.g. "https://www.facebook.com/mysticsaloon/")
 * @param venue  - Default venue context
 * @returns Array of extracted events, or empty array on failure
 */
export async function fetchFacebookEvents(
  pageUrl: string,
  venue: VenueContext,
  orgSlug: string = ""
): Promise<ExtractedEvent[]> {
  if (!getApifyToken()) {
    console.log("  Skipping Facebook (no APIFY_API_TOKEN set)");
    fbStatus[pageUrl] = { failed: false, error: "No API token configured" };
    return [];
  }

  console.log(`  Fetching Facebook posts via Apify: ${pageUrl}`);

  let posts: ApifyPostResult[];
  try {
    posts = await fetchApifyPosts(pageUrl, orgSlug);
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    // Log the full Apify error response for debugging
    if (err?.response?.data) {
      console.warn(`  Apify error response:`, JSON.stringify(err.response.data).slice(0, 500));
    }
    console.warn(`  Apify scrape failed: ${errorMsg}`);
    fbStatus[pageUrl] = { failed: true, error: errorMsg };
    return [];
  }

  if (posts.length === 0) {
    console.log("  Apify returned 0 posts");
    fbStatus[pageUrl] = { failed: false };
    return [];
  }

  console.log(`  Apify returned ${posts.length} posts`);

  // Convert posts to text for LLM extraction
  const text = postsToText(posts);
  if (text.length < 50) {
    console.warn("  Posts contained no meaningful text");
    fbStatus[pageUrl] = { failed: false };
    return [];
  }

  // Truncate to stay within LLM context limits
  const truncated = text.slice(0, 15000);
  console.log(`  Post text: ${text.length} chars (using first ${truncated.length})`);
  console.log(`  Preview:\n${text.slice(0, 500)}`);

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
    console.log(`  Extracted ${events.length} events from ${posts.length} Facebook posts`);
    return events;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.warn(`  LLM extraction from Facebook posts failed: ${errorMsg}`);
    fbStatus[pageUrl] = { failed: true, error: `LLM extraction failed: ${errorMsg}` };
    return [];
  }
}
