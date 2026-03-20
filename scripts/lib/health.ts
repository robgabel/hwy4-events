import { supabaseAdmin } from "./supabase-admin.js";
import { getFacebookStatus } from "./facebook.js";

interface SourceHealth {
  org_slug: string;
  future_event_count: number;
  latest_scraped_at: string | null;
  days_since_scrape: number | null;
}

/**
 * Run post-scrape health checks and print a summary report.
 * Flags sources with zero future events or stale scrape timestamps.
 */
export async function runHealthCheck(
  scrapedSources?: string[]
): Promise<void> {
  console.log("\n=== Scrape Health Report ===\n");

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  // Get all org_slugs that have ever had events
  const { data: allOrgs } = await supabaseAdmin
    .from("hwy4_events")
    .select("org_slug")
    .not("org_slug", "is", null);

  const orgSlugs = [...new Set((allOrgs || []).map((r) => r.org_slug))];

  if (orgSlugs.length === 0) {
    console.log("No sources found in database.");
    return;
  }

  const healthResults: SourceHealth[] = [];
  const warnings: string[] = [];

  for (const slug of orgSlugs) {
    // Count future events for this source
    const { count: futureCount } = await supabaseAdmin
      .from("hwy4_events")
      .select("id", { count: "exact", head: true })
      .eq("org_slug", slug)
      .gte("date", today);

    // Get most recent last_scraped_at
    const { data: latest } = await supabaseAdmin
      .from("hwy4_events")
      .select("last_scraped_at")
      .eq("org_slug", slug)
      .not("last_scraped_at", "is", null)
      .order("last_scraped_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestScraped = latest?.last_scraped_at || null;
    const daysSince = latestScraped
      ? Math.round((now - new Date(latestScraped).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    healthResults.push({
      org_slug: slug,
      future_event_count: futureCount ?? 0,
      latest_scraped_at: latestScraped,
      days_since_scrape: daysSince,
    });
  }

  // Print table
  console.log(
    "Source".padEnd(30) +
    "Future Events".padEnd(16) +
    "Last Scraped".padEnd(24) +
    "Status"
  );
  console.log("-".repeat(80));

  for (const h of healthResults.sort((a, b) => a.org_slug.localeCompare(b.org_slug))) {
    const scrapedStr = h.latest_scraped_at
      ? `${h.days_since_scrape}d ago`
      : "never";

    let status = "OK";

    // Zero future events for a source that was just scraped
    if (h.future_event_count === 0 && scrapedSources?.includes(h.org_slug)) {
      status = "WARN: 0 future events";
      warnings.push(
        `${h.org_slug}: Scraper ran but produced 0 future events. ` +
        `Check if the source has changed or is offline.`
      );
    } else if (h.future_event_count === 0) {
      status = "WARN: 0 future events";
      warnings.push(`${h.org_slug}: No future events in database.`);
    }

    // Staleness check: >7 days since last scrape
    if (h.days_since_scrape !== null && h.days_since_scrape > 7) {
      status = `STALE: ${h.days_since_scrape}d`;
      warnings.push(
        `${h.org_slug}: Not scraped in ${h.days_since_scrape} days. ` +
        `Scraper may be silently failing.`
      );
    } else if (h.days_since_scrape === null) {
      status = "STALE: never scraped";
      warnings.push(`${h.org_slug}: Has events but no last_scraped_at timestamp.`);
    }

    console.log(
      h.org_slug.padEnd(30) +
      String(h.future_event_count).padEnd(16) +
      scrapedStr.padEnd(24) +
      status
    );
  }

  // Facebook scraper status
  const fbStatus = getFacebookStatus();
  const fbPages = Object.entries(fbStatus);
  if (fbPages.length > 0) {
    console.log("\n--- Facebook Scraper Status ---");
    for (const [url, status] of fbPages) {
      if (status.failed) {
        console.log(`  FAILED: ${url} — ${status.error}`);
        warnings.push(
          `Facebook scraper failed for ${url}: ${status.error}. ` +
          `Website fallback was used. If this persists, facebook-event-scraper may need updating.`
        );
      } else {
        console.log(`  OK: ${url}`);
      }
    }
  }

  // Print warnings summary
  if (warnings.length > 0) {
    console.log(`\n--- ${warnings.length} warning(s) ---`);
    for (const w of warnings) {
      console.log(`  ⚠ ${w}`);
    }
  } else {
    console.log("\nAll sources healthy.");
  }

  console.log("");
}
