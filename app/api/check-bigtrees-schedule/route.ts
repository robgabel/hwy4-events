import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth, requireRegion } from "@/lib/cron-auth";
import { REGION } from "@/lib/region";
import {
  BIGTREES_FINGERPRINT_KEY,
  BIGTREES_PROGRAMS_PAGE,
  decideBigTreesWatch,
  isDuplicateWatchAlert,
  SCHEDULE_WATCH_ACTION_TYPE,
  type ScheduleWatchPayload,
} from "@/lib/bigtrees-watch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Weekly watcher for Calaveras Big Trees State Park's interpretive program schedule.
 *
 * The park publishes its season as recurrence rules in prose on
 * https://www.parks.ca.gov/?page_id=25994 (a server-rendered page). The scrapers
 * can't parse that prose, so the schedule is curated by hand in
 * scripts/lib/bigtrees-schedule.ts and the venue is blocklisted in
 * scripts/lib/manual-sources.ts.
 *
 * This route fingerprints the program list (not the page intro). When the list
 * changes, or the page still loads and the list is gone, it inserts a proposed
 * agent_actions row (type schedule_watch_alert) for the cockpit bot. It does
 * not post to Slack. It NEVER writes to hwy4_events.
 *
 * Auth: CRON_SECRET bearer. State: site_config key `bigtrees_schedule_fingerprint`.
 * Runs weekly via vercel.json; safe to hit manually to (re)arm the baseline.
 */

const UA = `Mozilla/5.0 (compatible; ${REGION.botName}/1.0; +${REGION.defaultSiteUrl})`;

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
    const res = await fetch(BIGTREES_PROGRAMS_PAGE, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[check-bigtrees-schedule] fetch ${res.status}`);
      return NextResponse.json({ ok: false, error: `fetch ${res.status}` }, { status: 200 });
    }
    html = await res.text();
  } catch (err) {
    console.error("[check-bigtrees-schedule] fetch failed:", err);
    return NextResponse.json({ ok: false, error: "fetch failed" }, { status: 200 });
  }

  const { data: prev } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", BIGTREES_FINGERPRINT_KEY)
    .maybeSingle();
  const previousFingerprint = (prev?.value as string | undefined) ?? null;

  const decision = decideBigTreesWatch({ html, previousFingerprint });

  let alerted = false;
  if (decision.alert) {
    const { data: open, error: openError } = await supabase
      .from("agent_actions")
      .select("payload")
      .eq("type", SCHEDULE_WATCH_ACTION_TYPE)
      .eq("status", "proposed")
      .limit(50);
    if (openError) {
      console.error("[check-bigtrees-schedule] alert lookup failed:", openError.message);
      return NextResponse.json({ ok: false, error: "alert lookup failed" }, { status: 200 });
    }
    const duplicate = isDuplicateWatchAlert(
      (open ?? []) as { payload?: Partial<ScheduleWatchPayload> | null }[],
      decision.alert
    );
    if (!duplicate) {
      const { error } = await supabase.from("agent_actions").insert(decision.alert);
      if (error) {
        console.error("[check-bigtrees-schedule] alert insert failed:", error.message);
        // Leave the stored fingerprint so the next run tries this alert again.
        return NextResponse.json({ ok: false, error: "alert insert failed" }, { status: 200 });
      }
      alerted = true;
    }
  }

  if (decision.storeFingerprint) {
    const { error } = await supabase.from("site_config").upsert(
      { key: BIGTREES_FINGERPRINT_KEY, value: decision.storeFingerprint },
      { onConflict: "key" }
    );
    if (error) console.error("[check-bigtrees-schedule] site_config upsert failed:", error);
  }

  return NextResponse.json({
    ok: true,
    read: decision.read,
    firstRun: !previousFingerprint,
    changed: decision.alert?.payload.kind === "changed",
    missing: decision.read === "missing",
    alerted,
    textLength: decision.textLength,
    fingerprint: decision.fingerprint,
  });
}
