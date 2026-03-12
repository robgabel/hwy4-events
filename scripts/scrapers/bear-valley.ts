import { launchBrowser, fetchPage, delay } from "../lib/browser.js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";

const EVENTS_URL = "https://www.bearvalley.com/events-activities";
const SOURCE_NAME = "Bear Valley Mountain Resort";
const ORG_SLUG = "bear-valley";
const MAX_POSTS = 20;
const POST_AGE_LIMIT_DAYS = 60;
const DELAY_MS = 1500; // Polite delay between page fetches

export async function scrapeBearValley(): Promise<void> {
  console.log("=== Bear Valley Scraper ===");
  console.log(`Fetching hub page: ${EVENTS_URL}`);

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    // Step 1: Fetch the events hub page
    const hubPage = await fetchPage(page, EVENTS_URL);

    // Step 2: Extract /post/* links
    const postLinks = hubPage.links
      .filter((link) => {
        try {
          const url = new URL(link);
          return (
            url.hostname === "www.bearvalley.com" &&
            url.pathname.startsWith("/post/")
          );
        } catch {
          return false;
        }
      })
      // Deduplicate links
      .filter((link, i, arr) => arr.indexOf(link) === i)
      .slice(0, MAX_POSTS);

    console.log(`Found ${postLinks.length} post links`);

    if (postLinks.length === 0) {
      console.warn("No post links found — page structure may have changed");
      return;
    }

    // Step 3: Fetch each post page
    const posts: { title: string; text: string; url: string }[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - POST_AGE_LIMIT_DAYS);

    for (const link of postLinks) {
      await delay(DELAY_MS);
      try {
        const postContent = await fetchPage(page, link);

        // Skip very short posts (likely navigation-only pages)
        if (postContent.text.trim().length < 50) {
          console.log(`  Skipping ${link} (too short)`);
          continue;
        }

        posts.push({
          title: postContent.title,
          text: postContent.text,
          url: link,
        });
        console.log(`  Fetched: ${postContent.title}`);
      } catch (err) {
        console.error(`  Failed to fetch ${link}:`, (err as Error).message);
      }
    }

    console.log(`\nFetched ${posts.length} posts, extracting events...`);

    // Step 4: Extract events via LLM
    const currentYear = new Date().getFullYear();
    const today = new Date().toISOString().slice(0, 10);
    let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

    for (const post of posts) {
      const events = await extractEvents(
        post.title,
        post.url,
        post.text,
        currentYear
      );

      if (events.length === 0) {
        console.log(`  No events found in: ${post.title}`);
        continue;
      }

      // Filter out past events
      const futureEvents = events.filter((e) => e.date >= today);
      console.log(
        `  ${post.title}: ${events.length} events extracted, ${futureEvents.length} future`
      );

      if (futureEvents.length === 0) continue;

      // Step 5: Upsert to Supabase
      const result = await upsertEvents(
        futureEvents,
        SOURCE_NAME,
        ORG_SLUG,
        post.url
      );

      totalResult.inserted += result.inserted;
      totalResult.updated += result.updated;
      totalResult.unchanged += result.unchanged;
    }

    console.log("\n=== Bear Valley Summary ===");
    console.log(`Posts crawled: ${posts.length}`);
    console.log(`Events inserted: ${totalResult.inserted}`);
    console.log(`Events updated: ${totalResult.updated}`);
    console.log(`Events unchanged: ${totalResult.unchanged}`);
  } finally {
    await browser.close();
  }
}
