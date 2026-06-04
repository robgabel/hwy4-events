import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL } from "@/lib/constants";

// First-party newsletter click tracker. Newsletter event links point here
// (/r/n/<campaign>/<eventId>); we log the click to newsletter_clicks, then 302 to
// the real event page. Links stay on hwy4events.com, and we own the data — the
// only reliable way to know which events get clicked from the email (Cloudflare
// RUM drops query strings and email carries no referer).
// See PRD-newsletter-click-tracking.md.

export const dynamic = "force-dynamic";

// Email security scanners and link-prefetchers click every link on delivery.
// Flag the obvious ones so the Growth tab can exclude them; we still log the row.
const BOT_UA =
  /bot|crawl|spider|slurp|scan|preview|proofpoint|mimecast|barracuda|googleimageproxy|cloudflare|curl|wget|python-requests|go-http|headless|monitor|validator|fetch/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaign: string; event: string }> }
) {
  const { campaign, event: eventId } = await params;
  const ua = request.headers.get("user-agent") ?? "";
  const isBot = BOT_UA.test(ua);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let dest = SITE_URL; // fallback so a real email link never dead-ends
  let slug: string | null = null;

  if (supabaseUrl && serviceKey && UUID_RE.test(eventId)) {
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: ev } = await supabase
      .from("hwy4_events")
      .select("name, date, town")
      .eq("id", eventId)
      .maybeSingle();

    if (ev) {
      slug = generateEventSlug(ev.name as string, ev.date as string, ev.town as string);
      const u = new URL(`${SITE_URL}/events/${slug}`);
      u.searchParams.set("utm_source", "newsletter");
      u.searchParams.set("utm_medium", "email");
      u.searchParams.set("utm_campaign", campaign);
      dest = u.toString();
    }

    // Best-effort log — a logging failure must never block the click.
    try {
      await supabase.from("newsletter_clicks").insert({
        campaign_id: campaign,
        event_id: ev ? eventId : null,
        slug,
        user_agent: ua.slice(0, 500) || null,
        is_bot: isBot,
      });
    } catch {
      /* ignore */
    }
  }

  return NextResponse.redirect(dest, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
