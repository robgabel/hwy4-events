import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const maxDuration = 60;

/**
 * Health-check cron that runs a few hours after the main briefing cron.
 * If the briefing is stale (not generated today), it calls generate-briefing
 * to self-heal. Returns status for monitoring.
 */
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

  // Check when the briefing was last generated
  const { data } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "weekly_briefing_date")
    .single();

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const generatedAt = data?.value ? new Date(data.value) : null;
  const generatedToday =
    generatedAt && generatedAt.toISOString().split("T")[0] === todayStr;

  if (generatedToday) {
    return NextResponse.json({
      ok: true,
      status: "fresh",
      generatedAt: data.value,
    });
  }

  // Briefing is stale — attempt to regenerate
  console.warn(
    `[check-briefing] Briefing is stale (last: ${data?.value ?? "never"}). Triggering regeneration.`
  );

  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://hwy4events.com";
    const res = await fetch(`${baseUrl}/api/generate-briefing`, {
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[check-briefing] Regeneration failed (${res.status}): ${body}`
      );
      return NextResponse.json(
        {
          ok: false,
          status: "stale",
          retryStatus: res.status,
          generatedAt: data?.value ?? null,
        },
        { status: 500 }
      );
    }

    const result = await res.json();
    console.log("[check-briefing] Regeneration succeeded:", result);
    return NextResponse.json({
      ok: true,
      status: "recovered",
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[check-briefing] Regeneration request failed:", err);
    return NextResponse.json(
      {
        ok: false,
        status: "stale",
        error: "Regeneration request failed",
        generatedAt: data?.value ?? null,
      },
      { status: 500 }
    );
  }
}
