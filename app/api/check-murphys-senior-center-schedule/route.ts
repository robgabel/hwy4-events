import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth, requireRegion } from "@/lib/cron-auth";
import { REGION } from "@/lib/region";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Weekly watcher for the Murphys Senior Center monthly events calendar.
 *
 * The center publishes its schedule ONLY as image files on
 * https://murphyscenter.com/calendar/ — a monthly calendar grid PNG plus a
 * newsletter PNG (e.g. wp-content/uploads/2026/05/2026-June-Calendar.png). There
 * is no HTML/JS event list to parse, so it can't be auto-scraped as text. Events
 * are curated by hand (the venue is blocklisted in scripts/lib/manual-sources.ts
 * so the scrapers never touch its rows).
 *
 * This route fingerprints the WordPress upload images on that page each week.
 * When the fingerprint changes (a new month's calendar/newsletter was posted, or
 * an image was replaced), it pings Slack so a human can eyeball the new calendar
 * and seed any new events. It NEVER writes to hwy4_events — by design the curated
 * rows change only when we say so.
 *
 * Auth: CRON_SECRET bearer. State: site_config key
 * `murphys_senior_center_schedule_fingerprint`. Runs weekly via vercel.json;
 * safe to hit manually to (re)arm the baseline.
 */

const EVENTS_PAGE = "https://murphyscenter.com/calendar/";
const CONFIG_KEY = "murphys_senior_center_schedule_fingerprint";
const UA = `Mozilla/5.0 (compatible; ${REGION.botName}/1.0; +${REGION.defaultSiteUrl})`;

/**
 * Stable fingerprint of the WordPress upload images on the page. Each image URL
 * is reduced to its upload path (`/wp-content/uploads/<year>/<month>/<file>`),
 * with WordPress's responsive `-WIDTHxHEIGHT` size suffix stripped so a srcset's
 * thumbnail variants collapse to one entry per source upload. Posting a new
 * month's calendar changes the path + filename, which changes the fingerprint.
 * Deduped and sorted for stability.
 */
function fingerprintImages(html: string): { fingerprint: string; images: string[] } {
  const keys = new Set<string>();
  for (const m of html.matchAll(
    /\/wp-content\/uploads\/[^"'\s)?\\]+?\.(?:png|jpe?g)/gi
  )) {
    // Collapse responsive variants: "...-791x1024.png" -> "....png".
    const normalized = m[0].replace(/-\d+x\d+(\.(?:png|jpe?g))$/i, "$1");
    keys.add(normalized.toLowerCase());
  }
  const images = [...keys].sort();
  const fingerprint = createHash("sha256").update(images.join("\n")).digest("hex");
  return { fingerprint, images };
}

async function postToSlack(text: string): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[check-murphys-senior-center-schedule] Slack post failed:", err);
  }
}

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;
  // Calaveras-only source watcher; no-op on other regions (vercel.json is shared).
  const skip = requireRegion("calaveras");
  if (skip) return skip;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let html: string;
  try {
    const res = await fetch(EVENTS_PAGE, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[check-murphys-senior-center-schedule] fetch ${res.status}`);
      return NextResponse.json({ ok: false, error: `fetch ${res.status}` }, { status: 200 });
    }
    html = await res.text();
  } catch (err) {
    console.error("[check-murphys-senior-center-schedule] fetch failed:", err);
    return NextResponse.json({ ok: false, error: "fetch failed" }, { status: 200 });
  }

  const { fingerprint, images } = fingerprintImages(html);

  const { data: prev } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", CONFIG_KEY)
    .maybeSingle();
  const prevFingerprint = prev?.value ?? null;

  // No images = the page structure changed or the fetch was degraded. Surface it
  // once (only if we had a baseline) instead of silently clobbering the baseline.
  if (images.length === 0) {
    console.error("[check-murphys-senior-center-schedule] no upload images found on page");
    if (prevFingerprint) {
      await postToSlack(
        `:warning: Murphys Senior Center schedule watcher found no calendar images on ${EVENTS_PAGE}. The page may have changed structure — worth a look.`
      );
    }
    return NextResponse.json({ ok: false, error: "no images found" }, { status: 200 });
  }

  const firstRun = !prevFingerprint;
  const changed = !firstRun && prevFingerprint !== fingerprint;

  if (firstRun || changed) {
    const { error } = await supabase
      .from("site_config")
      .upsert({ key: CONFIG_KEY, value: fingerprint }, { onConflict: "key" });
    if (error)
      console.error("[check-murphys-senior-center-schedule] site_config upsert failed:", error);
  }

  if (changed) {
    await postToSlack(
      `:calendar: *The Murphys Senior Center calendar may have changed.* The images on ${EVENTS_PAGE} differ from last week.\n` +
        "Open the monthly calendar/newsletter PNG, eyeball the lineup, and hand-seed any new public events (the venue is blocklisted from the auto-scrapers, so nothing ingests these automatically)."
    );
  }

  return NextResponse.json({ ok: true, firstRun, changed, imageCount: images.length, fingerprint });
}
