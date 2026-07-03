import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Weekly watcher for the Camp Connell General Store "Beer Garden" concert series.
 *
 * The store publishes its summer lineup ONLY as a poster image on
 * https://www.campconnellgeneralstore.com/events (a Squarespace graphic), so it
 * can't be parsed as text and isn't auto-scraped. The events are curated by hand
 * in scripts/seed-camp-connell-beer-garden-2026.ts, and the venue is blocklisted
 * in scripts/lib/manual-sources.ts so the scrapers never touch it.
 *
 * This route fingerprints the Squarespace CDN images on that page each week. When
 * the fingerprint changes (they swapped the poster — new season, a filled-in act,
 * a date change), it pings Slack so a human can eyeball the new lineup and update
 * + re-run the seed. It NEVER writes to hwy4_events — by design the curated rows
 * change only when we say so.
 *
 * Auth: CRON_SECRET bearer. State: site_config key `camp_connell_schedule_fingerprint`.
 * Runs weekly via vercel.json; safe to hit manually to (re)arm the baseline.
 */

const EVENTS_PAGE = "https://www.campconnellgeneralstore.com/events";
const CONFIG_KEY = "camp_connell_schedule_fingerprint";
const UA = "Mozilla/5.0 (compatible; Hwy4EventsBot/1.0; +https://hwy4events.com)";

/**
 * Stable fingerprint of the Squarespace CDN images on the page. Each image is
 * reduced to its content path (`content/v1/<siteId>/<uploadKey>/<filename>`),
 * with the trailing `?format=…` responsive query dropped so a srcset's size
 * variants collapse to one entry. Re-uploading the poster changes the uploadKey +
 * filename, which changes the fingerprint. Deduped and sorted for stability.
 */
function fingerprintImages(html: string): { fingerprint: string; images: string[] } {
  const keys = new Set<string>();
  for (const m of html.matchAll(/images\.squarespace-cdn\.com\/content\/v1\/[^"'\s)?\\]+/gi)) {
    keys.add(m[0]);
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
    console.error("[check-camp-connell-schedule] Slack post failed:", err);
  }
}

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

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
      console.error(`[check-camp-connell-schedule] fetch ${res.status}`);
      return NextResponse.json({ ok: false, error: `fetch ${res.status}` }, { status: 200 });
    }
    html = await res.text();
  } catch (err) {
    console.error("[check-camp-connell-schedule] fetch failed:", err);
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
    console.error("[check-camp-connell-schedule] no CDN images found on page");
    if (prevFingerprint) {
      await postToSlack(
        `:warning: Camp Connell Beer Garden schedule watcher found no images on ${EVENTS_PAGE}. The page may have changed structure — worth a look.`
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
    if (error) console.error("[check-camp-connell-schedule] site_config upsert failed:", error);
  }

  if (changed) {
    await postToSlack(
      `:beer: *The Camp Connell Beer Garden schedule may have changed.* The images on ${EVENTS_PAGE} differ from last week.\n` +
        "Compare against `scripts/seed-camp-connell-beer-garden-2026.ts`; if the lineup, dates, or cover changed, update the `SHOWS` array and re-run `npx tsx scripts/seed-camp-connell-beer-garden-2026.ts`. The venue is blocklisted from the auto-scrapers, so nothing updates these events automatically."
    );
  }

  return NextResponse.json({ ok: true, firstRun, changed, imageCount: images.length, fingerprint });
}
