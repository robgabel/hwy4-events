import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Weekly watcher for Calaveras Big Trees State Park's interpretive program schedule.
 *
 * The park publishes its season as recurrence rules in prose on
 * https://www.parks.ca.gov/?page_id=25994 (a server-rendered page). The scrapers
 * can't parse "Tuesdays and Saturdays June 13 - August 15," so the schedule is
 * curated by hand in scripts/seed-bigtrees-programs-2026.ts and the venue is
 * blocklisted in scripts/lib/manual-sources.ts so the auto-scrapers never touch it.
 *
 * This route fingerprints the program text on that page each week. When it changes
 * (the park updated the season), it pings Slack so a human can re-transcribe the
 * rules into lib/bigtrees-schedule.ts and re-run the seed. It NEVER writes to
 * hwy4_events — by design the curated rows change only when we say so.
 *
 * Auth: CRON_SECRET bearer. State: site_config key `bigtrees_schedule_fingerprint`.
 * Runs weekly via vercel.json; safe to hit manually to (re)arm the baseline.
 */

const SOURCE_PAGE = "https://www.parks.ca.gov/?page_id=25994";
const CONFIG_KEY = "bigtrees_schedule_fingerprint";
const UA = "Mozilla/5.0 (compatible; Hwy4EventsBot/1.0; +https://hwy4events.com)";

// The program content lives between the intro line and the footer nav. Slicing to
// this block keeps the fingerprint sensitive to schedule edits but blind to
// site-wide chrome (nav, alerts, related-pages list) that changes independently.
const START_MARKERS = [/all programs are free/i, /guided hikes and walks/i];
const END_MARKERS = [/^related pages$/i, /connect with california state parks/i];

/**
 * Reduce the page to the normalized plain text of its program section. Returns
 * "" if the section markers can't be found (page restructured / fetch degraded),
 * which the caller treats as a "look at this" signal rather than a silent change.
 */
function extractProgramText(html: string): string {
  const stripped = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|ul|ol|table|section|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = stripped
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const start = lines.findIndex((l) => START_MARKERS.some((m) => m.test(l)));
  if (start === -1) return "";
  const endRel = lines.slice(start).findIndex((l) => END_MARKERS.some((m) => m.test(l)));
  const end = endRel === -1 ? lines.length : start + endRel;

  return lines.slice(start, end).join("\n");
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
    console.error("[check-bigtrees-schedule] Slack post failed:", err);
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
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let html: string;
  try {
    const res = await fetch(SOURCE_PAGE, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[check-bigtrees-schedule] fetch ${res.status}`);
      return NextResponse.json({ ok: false, error: `fetch ${res.status}` }, { status: 200 });
    }
    html = await res.text();
  } catch (err) {
    console.error("[check-bigtrees-schedule] fetch failed:", err);
    return NextResponse.json({ ok: false, error: "fetch failed" }, { status: 200 });
  }

  const programText = extractProgramText(html);

  const { data: prev } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", CONFIG_KEY)
    .maybeSingle();
  const prevFingerprint = prev?.value ?? null;

  // Empty = markers not found: the page changed structure or the fetch was
  // degraded. Surface it once (only if we had a baseline) rather than clobbering.
  if (!programText || programText.length < 200) {
    console.error("[check-bigtrees-schedule] program section not found / too short");
    if (prevFingerprint) {
      await postToSlack(
        `:warning: Big Trees schedule watcher couldn't read the program section on ${SOURCE_PAGE}. The page may have changed structure — worth a look.`
      );
    }
    return NextResponse.json({ ok: false, error: "program section not found" }, { status: 200 });
  }

  const fingerprint = createHash("sha256").update(programText).digest("hex");
  const firstRun = !prevFingerprint;
  const changed = !firstRun && prevFingerprint !== fingerprint;

  if (firstRun || changed) {
    const { error } = await supabase
      .from("site_config")
      .upsert({ key: CONFIG_KEY, value: fingerprint }, { onConflict: "key" });
    if (error) console.error("[check-bigtrees-schedule] site_config upsert failed:", error);
  }

  if (changed) {
    await postToSlack(
      `:evergreen_tree: *Calaveras Big Trees may have updated its program schedule.* The program text on ${SOURCE_PAGE} differs from last week.\n` +
        "Re-transcribe the rules into `scripts/lib/bigtrees-schedule.ts` and re-run `npx tsx scripts/seed-bigtrees-programs-2026.ts`. The venue is blocklisted from the auto-scrapers, so nothing updates these events automatically."
    );
  }

  return NextResponse.json({ ok: true, firstRun, changed, textLength: programText.length, fingerprint });
}
