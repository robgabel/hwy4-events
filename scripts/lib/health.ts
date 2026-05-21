import { supabaseAdmin } from "./supabase-admin.js";
import { getFacebookStatus } from "./facebook.js";
import { isGenericVenue } from "./venue-matcher.js";

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

  await reportDataQualityIndex(today);

  console.log("");
}

/**
 * "Idiot index" pass: counts the size of the two failure piles (generic
 * venue, missing address) and prints the top offenders so the next hour
 * of registry work is obvious. Print-only — does not fail the build.
 */
async function reportDataQualityIndex(today: string): Promise<void> {
  const { data: rows } = await supabaseAdmin
    .from("hwy4_events")
    .select("venue_name, address, source_name, town, name, date")
    .gte("date", today);

  if (!rows || rows.length === 0) return;

  const unresolved = rows.filter((r) => isGenericVenue(r.venue_name ?? ""));
  const noAddress = rows.filter(
    (r) => !r.address || r.address.trim().length === 0
  );

  console.log("\n=== Data Quality Index ===");
  console.log(`Future events:            ${rows.length}`);
  console.log(`Generic venue_name:       ${unresolved.length}`);
  console.log(`Missing address:          ${noAddress.length}`);

  if (unresolved.length > 0) {
    console.log("\nTop unresolved by source:");
    const bySource = groupAndCount(unresolved, (r) => r.source_name ?? "(none)");
    for (const [src, n] of bySource.slice(0, 10)) {
      console.log(`  ${String(n).padStart(3)}  ${src}`);
    }
    console.log("\nUnresolved sample (first 5):");
    for (const r of unresolved.slice(0, 5)) {
      console.log(
        `  ${r.date} | ${r.name} | town=${r.town} | addr="${r.address ?? ""}"`
      );
    }
  }

  if (noAddress.length > 0) {
    console.log("\nTop missing-address by source:");
    const bySource = groupAndCount(noAddress, (r) => r.source_name ?? "(none)");
    for (const [src, n] of bySource.slice(0, 10)) {
      console.log(`  ${String(n).padStart(3)}  ${src}`);
    }
  }
}

function groupAndCount<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
