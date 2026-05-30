import { supabaseAdmin } from "./supabase-admin.js";
import { isUnstableHost } from "../../lib/event-link.js";

const BATCH_SIZE = 5; // concurrent HEAD requests
const TIMEOUT_MS = 10000;
const BATCH_DELAY_MS = 500; // delay between batches to avoid rate limiting

/**
 * Validate all event_url values in the database.
 * If a URL returns 404 or errors, set event_url to null.
 * This prevents broken links from appearing in the briefing and UI.
 */
export async function validateEventUrls(): Promise<{
  checked: number;
  broken: number;
  nulled: number;
}> {
  console.log("\n=== URL Validation ===");

  // Fetch all future events that have a URL
  const { data: events, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, event_url")
    .not("event_url", "is", null)
    .order("date", { ascending: true });

  if (error) {
    console.error("Failed to fetch events for URL validation:", error.message);
    return { checked: 0, broken: 0, nulled: 0 };
  }

  if (!events || events.length === 0) {
    console.log("No events with URLs to validate");
    return { checked: 0, broken: 0, nulled: 0 };
  }

  // Skip hosts we can't server-validate and don't render anyway (bot-walled
  // aggregators like GoCalaveras — see lib/event-link.ts). A 403 from them is
  // not a dead link, and the resolver never surfaces these URLs, so nulling
  // them would be a false positive that also destroys provenance.
  const skippedAggregator = events.filter(
    (e) => e.event_url && isUnstableHost(e.event_url)
  ).length;
  const checkable = events.filter(
    (e) => e.event_url && !isUnstableHost(e.event_url)
  );

  console.log(
    `Checking ${checkable.length} event URLs (${skippedAggregator} aggregator URLs skipped)...`
  );

  let broken = 0;
  let nulled = 0;
  let rateLimited = 0;
  const brokenIds: string[] = [];

  // Process in batches to avoid overwhelming servers
  for (let i = 0; i < checkable.length; i += BATCH_SIZE) {
    const batch = checkable.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (event) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

          const resp = await fetch(event.event_url, {
            method: "HEAD",
            redirect: "follow",
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
          });

          clearTimeout(timeout);

          // 429 = rate limited, not actually broken — skip
          if (resp.status === 429) {
            return { id: event.id, name: event.name, url: event.event_url, ok: true, status: 429, rateLimited: true };
          }
          if (resp.status >= 400) {
            return { id: event.id, name: event.name, url: event.event_url, ok: false, status: resp.status };
          }
          return { id: event.id, name: event.name, url: event.event_url, ok: true, status: resp.status };
        } catch (err) {
          return { id: event.id, name: event.name, url: event.event_url, ok: false, status: 0 };
        }
      })
    );

    for (const r of results) {
      if ((r as any).rateLimited) {
        rateLimited++;
      } else if (!r.ok) {
        broken++;
        brokenIds.push(r.id);
        console.log(`  BROKEN (${r.status}): ${r.name} → ${r.url}`);
      }
    }

    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < checkable.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Null out broken URLs in the database
  if (brokenIds.length > 0) {
    for (const id of brokenIds) {
      const { error: updateError } = await supabaseAdmin
        .from("hwy4_events")
        .update({ event_url: null })
        .eq("id", id);

      if (!updateError) {
        nulled++;
      } else {
        console.warn(`  Failed to null URL for event ${id}:`, updateError.message);
      }
    }
  }

  console.log(
    `URL validation: ${checkable.length} checked, ${broken} broken, ${nulled} nulled` +
    (rateLimited > 0 ? `, ${rateLimited} skipped (rate limited)` : "") +
    (skippedAggregator > 0 ? `, ${skippedAggregator} aggregator URLs skipped` : "")
  );
  return { checked: checkable.length, broken, nulled };
}
