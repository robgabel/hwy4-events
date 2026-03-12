import { launchBrowser, fetchPage, delay } from "../lib/browser.js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";

const EVENTS_URL = "https://www.bearvalley.com/events-activities";
const SOURCE_NAME = "Bear Valley Mountain Resort";
const ORG_SLUG = "bear-valley";
const MAX_POSTS = 20;
const DELAY_MS = 1500; // Polite delay between page fetches

export async function scrapeBearValley(): Promise<void> {
  console.log("=== Bear Valley Scraper ===");
  console.log(`Fetching hub page: ${EVENTS_URL}`);

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    // Step 1: Fetch the events hub page
    const hubPage = await fetchPage(page, EVENTS_URL, { scrollAndWait: true });

    // Log page info for debugging
    console.log(`Page title: ${hubPage.title}`);
    console.log(`Page text length: ${hubPage.text.length} chars`);
    console.log(`Total links found: ${hubPage.links.length}`);

    // Log unique internal links for debugging
    const internalLinks = hubPage.links
      .filter((link) => {
        try {
          return new URL(link).hostname === "www.bearvalley.com";
        } catch {
          return false;
        }
      })
      .filter((link, i, arr) => arr.indexOf(link) === i);
    console.log(`Unique internal links: ${internalLinks.length}`);
    for (const link of internalLinks.slice(0, 30)) {
      console.log(`  ${new URL(link).pathname}`);
    }

    // Step 2: Find event detail links (try multiple patterns)
    const eventLinks = internalLinks.filter((link) => {
      const pathname = new URL(link).pathname;
      return (
        pathname.startsWith("/post/") ||
        pathname.startsWith("/event/") ||
        pathname.startsWith("/events/") ||
        (pathname.includes("event") && pathname !== "/events-activities")
      );
    });

    const currentYear = new Date().getFullYear();
    const today = new Date().toISOString().slice(0, 10);
    let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

    if (eventLinks.length > 0) {
      // Strategy A: Scrape individual event pages
      console.log(`\nFound ${eventLinks.length} event links, scraping each...`);

      const posts: { title: string; text: string; url: string }[] = [];
      for (const link of eventLinks.slice(0, MAX_POSTS)) {
        await delay(DELAY_MS);
        try {
          const postContent = await fetchPage(page, link);
          if (postContent.text.trim().length < 50) {
            console.log(`  Skipping ${link} (too short)`);
            continue;
          }
          posts.push({ title: postContent.title, text: postContent.text, url: link });
          console.log(`  Fetched: ${postContent.title}`);
        } catch (err) {
          console.error(`  Failed to fetch ${link}:`, (err as Error).message);
        }
      }

      for (const post of posts) {
        const events = await extractEvents(post.title, post.url, post.text, currentYear);
        const futureEvents = events.filter((e) => e.date >= today);
        console.log(`  ${post.title}: ${events.length} events, ${futureEvents.length} future`);
        if (futureEvents.length === 0) continue;

        const result = await upsertEvents(futureEvents, SOURCE_NAME, ORG_SLUG, post.url);
        totalResult.inserted += result.inserted;
        totalResult.updated += result.updated;
        totalResult.unchanged += result.unchanged;
      }
    } else {
      // Strategy B: Extract events directly from the hub page content
      console.log("\nNo event detail links found — extracting from hub page directly");
      console.log(`Hub page text preview (first 500 chars):\n${hubPage.text.slice(0, 500)}`);

      const events = await extractEvents(
        hubPage.title,
        EVENTS_URL,
        hubPage.text,
        currentYear
      );

      const futureEvents = events.filter((e) => e.date >= today);
      console.log(`Extracted ${events.length} events, ${futureEvents.length} future`);

      if (futureEvents.length > 0) {
        totalResult = await upsertEvents(futureEvents, SOURCE_NAME, ORG_SLUG, EVENTS_URL);
      }
    }

    console.log("\n=== Bear Valley Summary ===");
    console.log(`Events inserted: ${totalResult.inserted}`);
    console.log(`Events updated: ${totalResult.updated}`);
    console.log(`Events unchanged: ${totalResult.unchanged}`);
  } finally {
    await browser.close();
  }
}
