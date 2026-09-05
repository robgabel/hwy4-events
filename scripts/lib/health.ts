import { supabaseAdmin } from "./supabase-admin.js";
import { getFacebookStatus } from "./facebook.js";
import { isGenericVenue } from "./venue-matcher.js";
import {
  classifySource,
  nightlyOrgSlugs,
  type SourceVerdict,
} from "./source-ownership.js";

/**
 * PostgREST caps an unbounded select at 1,000 rows, so reading a whole column
 * to derive its distinct values silently truncates the moment the table grows
 * past that — and it had. On 2026-09-05 hwy4_events held 1,844 rows, and this
 * report saw exactly the 13 org_slugs that fit in the first page: every source
 * sorting after "gocalaveras" was invisible, visit-murphys (108 upcoming rows,
 * the corridor's biggest feed), red-cross, sequoia-woods, murphys-irish-pub,
 * mystic-saloon and moose-lodge among them. The report whose entire job is to
 * notice a silently-failing scraper could not have noticed those six fail.
 *
 * It hid live findings too: hinterhaus-distilling and murphys-library had both
 * drained to zero future events with nothing saying so.
 *
 * A sensor that can fail silently is not a sensor (HWY-18), so this pages to
 * exhaustion and throws on a query error rather than degrading to an empty
 * list — which the old code did too, since it never checked `error` and an
 * empty result prints "No sources found in database." and returns clean.
 */
const ORG_SLUG_PAGE = 1000;
/** Bounds the loop below at ~1M rows so a misbehaving API can't spin forever. */
const ORG_SLUG_MAX_PAGES = 1000;

async function listOrgSlugsWithEvents(): Promise<string[]> {
  const slugs = new Set<string>();
  let from = 0;
  for (let page = 0; page < ORG_SLUG_MAX_PAGES; page++) {
    // The order is what makes range() paging correct: without it Postgres may
    // return rows in any order and pages can overlap or skip.
    const { data, error } = await supabaseAdmin
      .from("hwy4_events")
      .select("org_slug")
      .not("org_slug", "is", null)
      .order("org_slug", { ascending: true })
      .range(from, from + ORG_SLUG_PAGE - 1);
    if (error) {
      throw new Error(`Health report could not list sources: ${error.message}`);
    }
    const rows = data ?? [];
    for (const row of rows) {
      if (row.org_slug) slugs.add(row.org_slug);
    }
    // Advance by what actually came back, not by the page size we asked for.
    // The server's own row cap (Supabase's db-max-rows) can be lower than the
    // window we request, and a short page is then NOT the end of the data —
    // treating it as one would rebuild the exact truncation this replaces.
    if (rows.length === 0) break;
    from += rows.length;
  }
  return [...slugs];
}

interface SourceHealth {
  org_slug: string;
  future_event_count: number;
  latest_scraped_at: string | null;
  days_since_scrape: number | null;
}

/**
 * Run post-scrape health checks and print a summary report.
 *
 * Lists EVERY source — each org_slug that owns rows, plus every slug the
 * nightly dispatch can write even if it has never produced one — and asks
 * classifySource() what, if anything, a human should do about each. Warnings
 * are therefore per-owner rather than one staleness rule for all; see
 * scripts/lib/source-ownership.ts for why one rule could not work.
 *
 * scrape.ts catches a throw from here and logs it without failing the step:
 * the scrape itself already succeeded by this point, and the location sanity
 * check is the gate that turns a run red.
 */
export async function runHealthCheck(
  scrapedSources?: string[]
): Promise<void> {
  console.log("\n=== Scrape Health Report ===\n");

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  // Every slug that owns rows, UNION every slug the nightly dispatch can
  // write. The union is what surfaces a scraper that has never produced a
  // single row — the loudest possible failure, and the one the old
  // derive-from-existing-rows list could not represent at all.
  const ran = nightlyOrgSlugs(scrapedSources ?? []);
  const orgSlugs = [
    ...new Set([...(await listOrgSlugsWithEvents()), ...ran]),
  ];
  const ranThisRun = new Set(ran);

  if (orgSlugs.length === 0) {
    console.log("No sources found in database.");
    return;
  }

  const healthResults: (SourceHealth & { verdict: SourceVerdict })[] = [];
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

    const verdict = classifySource({
      orgSlug: slug,
      futureEventCount: futureCount ?? 0,
      daysSinceScrape: daysSince,
      // Compared against the org_slugs the dispatch keys actually write, not
      // the keys themselves — hwy4-fb-discover writes fb-discover-arnold.
      ranThisRun: ranThisRun.has(slug),
    });

    healthResults.push({
      org_slug: slug,
      future_event_count: futureCount ?? 0,
      latest_scraped_at: latestScraped,
      days_since_scrape: daysSince,
      verdict,
    });
    warnings.push(...verdict.warnings);
  }

  // Print table
  console.log(
    "Source".padEnd(32) +
    "Future".padEnd(9) +
    "Owner".padEnd(15) +
    "Last Write".padEnd(14) +
    "Status"
  );
  console.log("-".repeat(90));

  for (const h of healthResults.sort((a, b) => a.org_slug.localeCompare(b.org_slug))) {
    const scrapedStr = h.latest_scraped_at ? `${h.days_since_scrape}d ago` : "never";
    console.log(
      h.org_slug.padEnd(32) +
      String(h.future_event_count).padEnd(9) +
      h.verdict.owner.padEnd(15) +
      scrapedStr.padEnd(14) +
      h.verdict.status
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
  const { data: rows, count } = await supabaseAdmin
    .from("hwy4_events")
    .select("venue_name, address, source_name, town, name, date", { count: "exact" })
    .gte("date", today);

  if (!rows || rows.length === 0) return;

  // Same PostgREST 1,000-row ceiling that hid ten sources from the report
  // above. The upcoming set is ~330 today so this does not bite, but an
  // under-count here would read as "the pile shrank" — the most flattering
  // possible way for a quality metric to break. Say so instead.
  if (count !== null && count > rows.length) {
    console.warn(
      `  ⚠ Data quality index truncated: counted ${rows.length} of ${count} ` +
        `future events (PostgREST row cap). Figures below are an UNDER-count.`
    );
  }

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
