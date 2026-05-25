import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const maxDuration = 120; // Vision API calls can be slow

const VISION_PROMPT = `Extract event details from this flyer image. Return ONLY valid JSON, no markdown fences.

If this is an event flyer with a determinable date, return:
{
  "name": "event title (concise, title case)",
  "date": "YYYY-MM-DD",
  "start_time": "HH:MM" (24hr) or null,
  "end_time": "HH:MM" or null,
  "description": "1-2 sentence description of what the event is",
  "venue_hint": "specific location/venue mentioned on flyer, or null",
  "category_hint": "live_music|festival|civic|resort|lodge|other"
}

Category guidance:
- live_music: concerts, bands, DJ events, karaoke
- festival: large community celebrations, holiday events (July 4th, Memorial Day)
- civic: potlucks, meetings, bingo, movie nights, talent shows, classes
- lodge: lodge-specific dining or social events
- other: sports, recreation, camps, activities

If this is NOT an event flyer, or you cannot determine a specific date (just a general schedule), return:
{"skip": true, "reason": "brief explanation"}

The current year is 2026 unless the flyer clearly states otherwise.`;

const BLS_PAGES = [
  "https://blsha.com/events/",
  "https://blsha.com/recreation/",
];

interface ExtractedEvent {
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  venue_hint: string | null;
  category_hint: string;
}

interface SkipResult {
  skip: true;
  reason: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}

function resolveVenue(hint: string | null): string {
  if (!hint) return "Snowflake Lodge";
  const lower = hint.toLowerCase();
  if (lower.includes("bistro")) return "Blue Lake Bistro";
  if (lower.includes("amphitheater") || lower.includes("amphitheatre")) return "BLS Amphitheater";
  if (lower.includes("beach") || lower.includes("lake")) return "BLS Beach";
  if (lower.includes("pool")) return "BLS Pool";
  if (lower.includes("lodge") || lower.includes("snowflake")) return "Snowflake Lodge";
  return "Snowflake Lodge";
}

async function fetchImageUrls(): Promise<string[]> {
  const allUrls: string[] = [];

  for (const pageUrl of BLS_PAGES) {
    try {
      const res = await fetch(pageUrl);
      if (!res.ok) {
        console.error(`[scrape-bls] Failed to fetch ${pageUrl}: ${res.status}`);
        continue;
      }
      const html = await res.text();

      // Extract image URLs from the HTML — BLS posts event flyers as images
      const imgRegex = /https?:\/\/blsha\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s)]+\.(?:jpe?g|png)/gi;
      const matches = html.match(imgRegex) || [];

      // Deduplicate and filter to likely event flyers (skip tiny thumbnails)
      const unique = [...new Set(matches)].filter((url) => {
        // Skip thumbnail sizes (usually contain dimensions like -150x150)
        if (/-\d{2,3}x\d{2,3}\.\w+$/.test(url)) return false;
        return true;
      });

      allUrls.push(...unique);
    } catch (err) {
      console.error(`[scrape-bls] Error fetching ${pageUrl}:`, err);
    }
  }

  return [...new Set(allUrls)];
}

async function extractEventFromImage(
  anthropic: Anthropic,
  imageUrl: string
): Promise<ExtractedEvent | null> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "url",
                url: imageUrl,
              },
            },
            {
              type: "text",
              text: VISION_PROMPT,
            },
          ],
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") return null;

    // Parse the JSON response — handle potential markdown fencing
    let jsonText = block.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed: ExtractedEvent | SkipResult = JSON.parse(jsonText);

    if ("skip" in parsed && parsed.skip) {
      console.log(`[scrape-bls] Skipped image: ${parsed.reason} — ${imageUrl}`);
      return null;
    }

    const event = parsed as ExtractedEvent;

    // Validate required fields
    if (!event.name || !event.date) {
      console.log(`[scrape-bls] Missing name or date for ${imageUrl}`);
      return null;
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
      console.log(`[scrape-bls] Invalid date format: ${event.date}`);
      return null;
    }

    return event;
  } catch (err) {
    console.error(`[scrape-bls] Vision extraction failed for ${imageUrl}:`, err);
    return null;
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Fetch all flyer image URLs from BLS pages
    const imageUrls = await fetchImageUrls();
    console.log(`[scrape-bls] Found ${imageUrls.length} flyer images`);

    if (imageUrls.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No flyer images found",
        stats: { images: 0, extracted: 0, inserted: 0, skipped: 0, duplicates: 0 },
      });
    }

    // 2. Extract event data from each image using Vision AI
    // Run with bounded concurrency — sequential blew past Vercel's 120s timeout
    // once BLS started posting ~40+ flyers (broken since 2026-04-27).
    const extractedEvents: ExtractedEvent[] = [];
    const imageToEvent = new Map<string, ExtractedEvent>();
    const CONCURRENCY = 5;

    for (let i = 0; i < imageUrls.length; i += CONCURRENCY) {
      const batch = imageUrls.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((url) =>
          extractEventFromImage(anthropic, url).then((event) => ({ url, event }))
        )
      );
      for (const { url, event } of results) {
        if (event) {
          extractedEvents.push(event);
          imageToEvent.set(url, event);
        }
      }
    }

    console.log(`[scrape-bls] Extracted ${extractedEvents.length} events from ${imageUrls.length} images`);

    // 3. Filter out past events
    const today = new Date().toISOString().split("T")[0];
    const futureEvents = extractedEvents.filter((e) => e.date >= today);
    console.log(`[scrape-bls] ${futureEvents.length} future events after date filter`);

    // 4. Check for existing events (dedup)
    const dedupKeys = futureEvents.map(
      (e) => `bls-${e.date}-${slugify(e.name)}`
    );

    const { data: existing } = await supabase
      .from("hwy4_events")
      .select("dedup_key")
      .in("dedup_key", dedupKeys);

    const existingKeys = new Set((existing || []).map((e) => e.dedup_key));

    // 5. Insert new events
    const newEvents = futureEvents.filter((e) => {
      const key = `bls-${e.date}-${slugify(e.name)}`;
      return !existingKeys.has(key);
    });

    let insertedCount = 0;
    const errors: string[] = [];

    for (const event of newEvents) {
      const dedupKey = `bls-${event.date}-${slugify(event.name)}`;
      const venue = resolveVenue(event.venue_hint);
      const validCategories = ["live_music", "festival", "civic", "resort", "lodge", "other"];
      const category = validCategories.includes(event.category_hint)
        ? event.category_hint
        : "civic";

      // Find the image URL for this event (for image_url field)
      let eventImageUrl: string | null = null;
      for (const [imgUrl, evt] of imageToEvent.entries()) {
        if (evt === event) {
          eventImageUrl = imgUrl;
          break;
        }
      }

      const { error } = await supabase.from("hwy4_events").insert({
        name: event.name,
        date: event.date,
        start_time: event.start_time,
        end_time: event.end_time,
        description: event.description,
        venue_name: venue,
        town: "Arnold",
        category,
        status: "confirmed",
        visibility: "private",
        org_slug: "blue-lake-springs",
        source_url: "https://blsha.com/events/",
        source_name: "Blue Lake Springs HOA",
        dedup_key: dedupKey,
        last_scraped_at: new Date().toISOString(),
        image_url: eventImageUrl,
        robs_pick: false,
        is_weekly: false,
      });

      if (error) {
        console.error(`[scrape-bls] Insert failed for "${event.name}":`, error);
        errors.push(`${event.name}: ${error.message}`);
      } else {
        insertedCount++;
        console.log(`[scrape-bls] Inserted: ${event.name} on ${event.date}`);
      }
    }

    const stats = {
      images: imageUrls.length,
      extracted: extractedEvents.length,
      future: futureEvents.length,
      duplicates: futureEvents.length - newEvents.length,
      inserted: insertedCount,
      errors: errors.length,
    };

    console.log("[scrape-bls] Complete:", stats);

    return NextResponse.json({
      ok: true,
      stats,
      ...(errors.length > 0 && { errors }),
      events: newEvents.map((e) => ({
        name: e.name,
        date: e.date,
        venue: resolveVenue(e.venue_hint),
      })),
    });
  } catch (err) {
    console.error("[scrape-bls] Scraper failed:", err);
    return NextResponse.json(
      { error: "Scraper failed", details: String(err) },
      { status: 500 }
    );
  }
}
