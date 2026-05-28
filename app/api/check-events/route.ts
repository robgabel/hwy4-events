import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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
 * Runs daily via vercel.json cron — keep this READ-ONLY (no mutations).
 */

const VALID_CATEGORIES = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "games",
  "other",
];

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
  venue_name: string | null;
  category: string | null;
  visibility: string | null;
  image_url: string | null;
  org_slug: string | null;
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

  const supabase = createClient(supabaseUrl, serviceKey);
  const today = new Date().toISOString().split("T")[0];
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Pull all future events — small enough table that one round-trip is fine.
  const { data: events, error } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, date, venue_name, category, visibility, image_url, org_slug, last_scraped_at, status"
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

  const summary = {
    audited_at: new Date().toISOString(),
    total_future_events: rows.length,
    issues: {
      duplicates: duplicates.length,
      hidden: hidden.length,
      missing_venue: missingVenue.length,
      invalid_category: invalidCategory.length,
      missing_image_bls: missingImageBls.length,
      stale_scrapes: stale.length,
    },
  };

  const totalIssues = Object.values(summary.issues).reduce((a, b) => a + b, 0);
  console.log("[check-events] Audit complete:", summary);

  // Post to Slack if there are issues and webhook is configured.
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (webhook && totalIssues > 0) {
    const lines: string[] = [`*Hwy4 events audit — ${totalIssues} issue(s)*`];
    if (duplicates.length > 0) {
      lines.push(`\n*${duplicates.length} duplicate group(s):*`);
      for (const d of duplicates.slice(0, 10)) {
        lines.push(
          `• \`${d.date}\` "${d.names[0]}" ×${d.count} — venues: ${d.venues.join(" / ")}`
        );
      }
      if (duplicates.length > 10) lines.push(`  …and ${duplicates.length - 10} more`);
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
    if (invalidCategory.length > 0) {
      lines.push(`\n*${invalidCategory.length} event(s) with invalid/missing category*`);
    }
    if (missingImageBls.length > 0) {
      lines.push(`\n*${missingImageBls.length} BLS event(s) missing flyer image*`);
    }
    if (stale.length > 0) {
      lines.push(`\n*${stale.length} future event(s) not re-scraped in 14+ days*`);
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
      hidden,
      missing_venue: missingVenue,
      invalid_category: invalidCategory,
      missing_image_bls: missingImageBls,
      stale_scrapes: stale,
    },
  });
}
