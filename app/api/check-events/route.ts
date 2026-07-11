import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { findDuplicateClusters } from "@/lib/dedupe-events";
import { computeActionableLinkGaps, GAP_VENUE_THRESHOLD } from "@/lib/link-gaps";
import { AUDIT_SIGNAL_KEY } from "@/lib/agent/audit-signal";

export const maxDuration = 60;

/**
 * Daily data-quality audit on the hwy4_events table.
 *
 * Detects:
 *  - Duplicates: same date + normalized name, different IDs.
 *  - Hidden future events: visibility='private' (likely a scraper bug, not intent).
 *  - Missing fields: no venue_name, missing/invalid category, missing image_url
 *    on BLS rows (BLS events always come from flyer images).
 *  - Stale scrapes: future events whose last_scraped_at is > 14 days old.
 *
 * Posts a summary to SLACK_WEBHOOK_URL if set; always returns JSON.
 * Runs daily via vercel.json cron — keep this READ-ONLY against event data
 * (no hwy4_events mutations). The one write is a monitoring artifact: the
 * compact summary is upserted to site_config (AUDIT_SIGNAL_KEY) so the
 * chief-of-staff digest an hour later can see what this audit saw — without
 * it the digest headlined "all quiet" while this route posted a backlog to
 * the same Slack channel (2026-07-10).
 */

const VALID_CATEGORIES = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "games",
  "fine_arts",
  "other",
];

/**
 * Venue names the scraper uses when it couldn't resolve a real venue. Kept in
 * sync with scripts/lib/venues.ts GENERIC_VENUE_NAMES — duplicated here because
 * the Next app and the scraper package have separate module roots.
 */
const GENERIC_VENUE_NAMES = new Set([
  "downtown murphys",
  "unknown venue",
  "unknown",
  "tbd",
  "angels camp",
  "murphys",
  "arnold",
  "copperopolis",
  "avery",
  "dorrington",
  "camp connell",
  "bear valley",
  "white pines",
]);
const POISONED_VENUE_PREFIX = /^(featuring|hosted by|with|feat\.?|w\/)\b/;

/** A venue_name that names a real place (not a scraper fallback / poisoned string). */
function isUnresolvedVenue(venue: string | null): boolean {
  if (!venue) return false; // null handled by the missing_venue check
  const n = venue.toLowerCase().trim();
  return GENERIC_VENUE_NAMES.has(n) || POISONED_VENUE_PREFIX.test(n);
}

/** A street address with a leading house number, e.g. "472 Main St, Murphys". */
function looksLikeStreetAddress(a: string | null): boolean {
  if (!a) return false;
  return /^\d+[A-Z]?\s+[A-Za-z]/.test(a.trim());
}

/** A town-only address with no street component, e.g. "Murphys, CA 95247". */
function isTownOnlyAddress(a: string | null): boolean {
  if (!a) return false;
  return /^[A-Za-z .'-]+,\s*(CA|California)(\s+\d{5}(-\d{4})?)?\s*$/i.test(a.trim());
}

interface DuplicateGroup {
  date: string;
  normalized_name: string;
  count: number;
  ids: string[];
  names: string[];
  venues: string[];
}

interface EventRow {
  id: string;
  name: string;
  date: string;
  town: string;
  venue_name: string | null;
  venue_key: string | null;
  address: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  artists: string[] | null;
  category: string | null;
  visibility: string | null;
  image_url: string | null;
  org_slug: string | null;
  event_url: string | null;
  last_scraped_at: string | null;
  status: string | null;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {

  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const today = new Date().toISOString().split("T")[0];
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Pull all future events — small enough table that one round-trip is fine.
  const { data: events, error } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, date, town, venue_name, venue_key, address, start_time, end_time, description, artists, category, visibility, image_url, org_slug, event_url, last_scraped_at, status"
    )
    .gte("date", today)
    .order("date", { ascending: true });

  if (error) {
    console.error("[check-events] Query failed:", error);
    return NextResponse.json(
      { error: "Query failed", details: error.message },
      { status: 500 }
    );
  }

  const rows = (events ?? []) as EventRow[];

  // 1. Duplicates — group by (date, normalized name) where count > 1.
  const groups = new Map<string, EventRow[]>();
  for (const row of rows) {
    const key = `${row.date}|${normalizeName(row.name)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const duplicates: DuplicateGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length > 1) {
      const [date, normalized_name] = key.split("|");
      duplicates.push({
        date,
        normalized_name,
        count: list.length,
        ids: list.map((r) => r.id),
        names: list.map((r) => r.name),
        venues: list.map((r) => r.venue_name ?? "—"),
      });
    }
  }

  // 1b. Same-event duplicates the name check misses — same town + date +
  // exact time + a strong signal (venue / description / artists) but a
  // different title. These slip past the title-based dedup_key. Report only
  // clusters whose normalized names differ, to avoid double-counting (1).
  const sameEventDupes = findDuplicateClusters(
    rows.filter((r) => r.status !== "cancelled")
  )
    .filter((cluster) => {
      const distinctNames = new Set(cluster.map((r) => normalizeName(r.name)));
      return distinctNames.size > 1;
    })
    .map((cluster) => ({
      date: cluster[0].date,
      town: cluster[0].town,
      start_time: cluster[0].start_time,
      count: cluster.length,
      ids: cluster.map((r) => r.id),
      names: cluster.map((r) => r.name),
      venues: cluster.map((r) => r.venue_name ?? "—"),
    }));

  // 2. Hidden future events.
  const hidden = rows
    .filter((r) => r.visibility !== "public" && r.status !== "cancelled")
    .map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      visibility: r.visibility,
      org_slug: r.org_slug,
    }));

  // 3. Missing or invalid fields.
  const missingVenue = rows
    .filter((r) => !r.venue_name)
    .map((r) => ({ id: r.id, name: r.name, date: r.date }));

  const invalidCategory = rows
    .filter((r) => !r.category || !VALID_CATEGORIES.includes(r.category))
    .map((r) => ({ id: r.id, name: r.name, date: r.date, category: r.category }));

  const missingImageBls = rows
    .filter((r) => r.org_slug === "blue-lake-springs" && !r.image_url)
    .map((r) => ({ id: r.id, name: r.name, date: r.date }));

  // Unresolved venue: a scraper fallback ("Unknown Venue", a bare town) or a
  // poisoned string ("Featuring …"). Distinct from missing_venue (null).
  const unresolvedVenue = rows
    .filter((r) => isUnresolvedVenue(r.venue_name))
    .map((r) => ({ id: r.id, name: r.name, date: r.date, venue_name: r.venue_name }));

  // Unresolved address: null or town-only (pins the map to the town centroid
  // instead of the venue). These are the rows a registry entry would fix.
  const unresolvedAddress = rows
    .filter((r) => !looksLikeStreetAddress(r.address) && (!r.address || isTownOnlyAddress(r.address)))
    .map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      venue_name: r.venue_name,
      address: r.address,
    }));

  // 4. Stale scrapes — future events whose last_scraped_at is > 14 days old.
  const stale = rows
    .filter(
      (r) => r.last_scraped_at !== null && r.last_scraped_at < fourteenDaysAgo
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      last_scraped_at: r.last_scraped_at,
      org_slug: r.org_slug,
    }));

  // Recent self-healing merges (lib/reconcile.ts via /api/reconcile-dupes).
  // Informational, NOT an issue — a merge means the dedup is working. Reported
  // separately so it never inflates totalIssues / triggers a false alarm. Stays
  // 0 during the dry-run canary week (dry-run writes no log rows). Tolerant of
  // the table not existing yet (pre-migration) — the audit must not crash.
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let mergesLast24h: number | null = null;
  const { count: mergeCount, error: mergeErr } = await supabase
    .from("event_merge_log")
    .select("*", { count: "exact", head: true })
    .gte("merged_at", twentyFourHoursAgo);
  if (mergeErr) {
    console.error("[check-events] event_merge_log query failed:", mergeErr.message);
  } else {
    mergesLast24h = mergeCount ?? 0;
  }

  // Link-resolution coverage. We track events whose best available link is only
  // a non-durable aggregator fallback (GoCalaveras) — those render a button now,
  // but they're still worth upgrading to a real organizer canonical if the venue
  // is high-frequency. A raw gap count would lie (a siteless one-off venue with
  // no link is the CORRECT terminal state), so we report two numbers:
  // `aggregatorFallbackLinks` is the raw count of events using the non-durable
  // fallback (trend signal); `actionableCanonicalGaps` is the worklist of venues
  // at/above the threshold — each is worth one hwy4_orgs row (~10 min).
  // Deliberately NO auto-discovery (see "Outbound Event Links" in CLAUDE.md).
  // Shared with the cockpit's create_org_row proposer via lib/link-gaps.ts so the
  // audit and the proposer can't drift. Guarded so a failure never breaks the audit.
  let aggregatorFallbackLinks: number | null = null;
  let actionableLinkGaps: { venue: string; count: number }[] = [];
  try {
    const report = await computeActionableLinkGaps(supabase, rows);
    aggregatorFallbackLinks = report.rawFallbackCount;
    actionableLinkGaps = report.actionable.map((a) => ({ venue: a.venue, count: a.count }));
  } catch (err) {
    console.error("[check-events] link-gap computation failed:", err);
  }

  // Analytics-snapshot freshness — the freshness alarm for analytics_daily. That
  // table is the durable local history that outlives Cloudflare's SHORT free-RUM
  // retention, so if the daily /api/snapshot-analytics cron silently stops (token
  // expiry, CF schema change, Supabase blip), the un-snapshotted days are lost for
  // good within that window. The snapshot writes the *previous* UTC day at 09:00
  // UTC and this audit runs at 18:00 UTC, so the latest row should be yesterday:
  // >=2 days behind means a run was missed, and a fresh-but-zero latest row means
  // the cron ran but the CF read returned nothing. Guarded so it never breaks the
  // audit. See PRD-cloudflare-analytics.md.
  let analyticsStaleReason: string | null = null;
  let analyticsLatest: { date: string; pageviews: number } | null = null;
  try {
    const { data: latestRows, error: aErr } = await supabase
      .from("analytics_daily")
      .select("date, pageviews")
      .order("date", { ascending: false })
      .limit(1);
    if (aErr) {
      console.error("[check-events] analytics_daily freshness query failed:", aErr.message);
    } else {
      const latest = latestRows?.[0] as { date: string; pageviews: number } | undefined;
      if (!latest) {
        analyticsStaleReason = "no rows in analytics_daily — the snapshot cron has never written";
      } else {
        analyticsLatest = { date: latest.date, pageviews: latest.pageviews };
        const daysBehind = Math.floor(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.date}T00:00:00Z`)) / 86400000
        );
        if (daysBehind >= 2) {
          analyticsStaleReason = `latest snapshot is ${latest.date} (${daysBehind} days behind) — the daily snapshot-analytics cron may be failing`;
        } else if ((latest.pageviews ?? 0) === 0) {
          analyticsStaleReason = `latest snapshot (${latest.date}) captured 0 pageviews — the CF read may be silently failing`;
        }
      }
    }
  } catch (err) {
    console.error("[check-events] analytics freshness check failed:", err);
  }
  const analyticsStale = analyticsStaleReason !== null;

  const summary = {
    audited_at: new Date().toISOString(),
    total_future_events: rows.length,
    merges_last_24h: mergesLast24h,
    aggregator_fallback_links: aggregatorFallbackLinks,
    actionable_link_gaps: actionableLinkGaps.length,
    actionable_link_gap_venues: actionableLinkGaps,
    analytics: {
      latest_date: analyticsLatest?.date ?? null,
      latest_pageviews: analyticsLatest?.pageviews ?? null,
      stale: analyticsStale,
      stale_reason: analyticsStaleReason,
    },
    issues: {
      duplicates: duplicates.length,
      same_event_duplicates: sameEventDupes.length,
      hidden: hidden.length,
      missing_venue: missingVenue.length,
      unresolved_venue: unresolvedVenue.length,
      unresolved_address: unresolvedAddress.length,
      invalid_category: invalidCategory.length,
      missing_image_bls: missingImageBls.length,
      stale_scrapes: stale.length,
    },
  };

  const totalIssues = Object.values(summary.issues).reduce((a, b) => a + b, 0);
  console.log("[check-events] Audit complete:", summary);

  // Persist the compact summary for the chief-of-staff digest (19:00 UTC, an
  // hour after this audit). Shape consumed by lib/agent/audit-signal.ts
  // (parseAuditSignal). Best-effort: a failed stash never breaks the audit.
  try {
    const auditSignal = {
      audited_at: summary.audited_at,
      total_future_events: summary.total_future_events,
      issues: summary.issues,
      actionable_link_gaps: actionableLinkGaps.length,
      analytics_stale: analyticsStale,
      analytics_stale_reason: analyticsStaleReason,
      samples: {
        unresolved_venue: unresolvedVenue
          .slice(0, 3)
          .map((u) => `"${u.name}" (${u.date}, venue="${u.venue_name}")`),
        unresolved_address: unresolvedAddress
          .slice(0, 3)
          .map((u) => `"${u.name}" @ ${u.venue_name ?? "?"} (${u.date})`),
        actionable_link_gaps: actionableLinkGaps
          .slice(0, 3)
          .map((g) => `${g.venue} (${g.count} events)`),
      },
    };
    const { error: stashErr } = await supabase.from("site_config").upsert(
      {
        key: AUDIT_SIGNAL_KEY,
        value: JSON.stringify(auditSignal),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (stashErr) console.error("[check-events] audit-signal stash failed:", stashErr.message);
  } catch (err) {
    console.error("[check-events] audit-signal stash failed:", err);
  }

  // Post to Slack if there are issues, a high-frequency link gap to nudge, or the
  // analytics snapshot has gone stale (a data-loss risk — see the freshness check).
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook && (totalIssues > 0 || actionableLinkGaps.length > 0 || analyticsStale)) {
    const header =
      totalIssues > 0
        ? `${totalIssues} issue(s)`
        : analyticsStale
          ? "analytics snapshot stale"
          : "no issues — link-gap nudge";
    const lines: string[] = [`*Hwy4 events audit — ${header}*`];
    if (analyticsStale) {
      lines.push(`\n:rotating_light: *Analytics snapshot stale:* ${analyticsStaleReason}.`);
      lines.push(
        `_Durable history can't be backfilled past Cloudflare's short RUM retention — check the /api/snapshot-analytics cron + CLOUDFLARE_* env._`
      );
    }
    if (duplicates.length > 0) {
      lines.push(`\n*${duplicates.length} duplicate group(s):*`);
      for (const d of duplicates.slice(0, 10)) {
        lines.push(
          `• \`${d.date}\` "${d.names[0]}" ×${d.count} — venues: ${d.venues.join(" / ")}`
        );
      }
      if (duplicates.length > 10) lines.push(`  …and ${duplicates.length - 10} more`);
    }
    if (sameEventDupes.length > 0) {
      lines.push(`\n*${sameEventDupes.length} same-event duplicate(s) (diff title, same venue/time):*`);
      for (const d of sameEventDupes.slice(0, 10)) {
        lines.push(
          `• \`${d.date}\` ${d.start_time ?? "?"} ${d.town} — ${d.names.map((n) => `"${n}"`).join(" / ")}`
        );
      }
      if (sameEventDupes.length > 10) lines.push(`  …and ${sameEventDupes.length - 10} more`);
    }
    if (hidden.length > 0) {
      lines.push(`\n*${hidden.length} hidden future event(s):*`);
      for (const h of hidden.slice(0, 5)) {
        lines.push(`• \`${h.date}\` ${h.name} (${h.org_slug}, visibility=${h.visibility})`);
      }
      if (hidden.length > 5) lines.push(`  …and ${hidden.length - 5} more`);
    }
    if (missingVenue.length > 0) {
      lines.push(`\n*${missingVenue.length} event(s) missing venue*`);
    }
    if (unresolvedVenue.length > 0) {
      lines.push(`\n*${unresolvedVenue.length} event(s) with an unresolved venue:*`);
      for (const u of unresolvedVenue.slice(0, 5)) {
        lines.push(`• \`${u.date}\` ${u.name} — venue="${u.venue_name}"`);
      }
      if (unresolvedVenue.length > 5) lines.push(`  …and ${unresolvedVenue.length - 5} more (add to scripts/lib/venues.ts)`);
    }
    if (unresolvedAddress.length > 0) {
      lines.push(`\n*${unresolvedAddress.length} event(s) with no precise address:*`);
      for (const u of unresolvedAddress.slice(0, 5)) {
        lines.push(`• \`${u.date}\` ${u.name} @ ${u.venue_name} — address=${u.address ?? "null"}`);
      }
      if (unresolvedAddress.length > 5) lines.push(`  …and ${unresolvedAddress.length - 5} more`);
    }
    if (invalidCategory.length > 0) {
      lines.push(`\n*${invalidCategory.length} event(s) with invalid/missing category*`);
    }
    if (missingImageBls.length > 0) {
      lines.push(`\n*${missingImageBls.length} BLS event(s) missing flyer image*`);
    }
    if (stale.length > 0) {
      lines.push(`\n*${stale.length} future event(s) not re-scraped in 14+ days*`);
    }
    if (mergesLast24h && mergesLast24h > 0) {
      lines.push(`\n_${mergesLast24h} duplicate merge(s) auto-healed in the last 24h (reversible via event_merge_log)._`);
    }
    if (actionableLinkGaps.length > 0) {
      lines.push(`\n*${actionableLinkGaps.length} single-operator venue(s) worth a canonical link (≥${GAP_VENUE_THRESHOLD} upcoming events, aggregator-only link):*`);
      for (const g of actionableLinkGaps.slice(0, 10)) {
        lines.push(`• ${g.venue} — ${g.count} events`);
      }
      if (actionableLinkGaps.length > 10) lines.push(`  …and ${actionableLinkGaps.length - 10} more`);
      lines.push(`_Add canonical_url + match_patterns to the matching hwy4_orgs row to upgrade to a durable link (≈10 min). ${aggregatorFallbackLinks ?? 0} events currently use the GoCalaveras fallback; long-tail one-offs are fine as-is._`);
    }

    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: lines.join("\n") }),
      });
    } catch (err) {
      console.error("[check-events] Slack post failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    summary,
    details: {
      duplicates,
      same_event_duplicates: sameEventDupes,
      hidden,
      missing_venue: missingVenue,
      unresolved_venue: unresolvedVenue,
      unresolved_address: unresolvedAddress,
      invalid_category: invalidCategory,
      missing_image_bls: missingImageBls,
      stale_scrapes: stale,
    },
  });
}
