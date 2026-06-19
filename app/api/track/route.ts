import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { classifyVisitor, geoFromHeaders } from "@/lib/geo";

// Gate 0 engagement beacon (BUSINESS-PLAN.md §15). Logs one row to site_events
// per page view (geo-classified visitor/local) or per outbound business-referral
// click. Mirrors /api/track-share: best-effort, NEVER returns an error to the
// client, writes via the service role.

export const dynamic = "force-dynamic";

const VALID_CLICK = new Set([
  "more_info",
  "directions",
  "venue_website",
  "venue_phone",
  "venue_maps",
]);

// Crude UA bot filter — keeps obvious crawlers/scanners out of the human signal.
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|monitor|preview|curl|wget|python-requests|axios|node-fetch|lighthouse|pingdom|uptime|gptbot|claudebot|perplexity/i;

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const clamp = (v: unknown, n: number): string | null =>
  typeof v === "string" ? v.slice(0, n) : null;

export async function POST(request: Request) {
  const ok = () => NextResponse.json({ ok: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return ok();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return ok();
  }

  const kind =
    body.kind === "view" || body.kind === "outbound" ? body.kind : null;
  if (!kind) return ok();

  const path = clamp(body.path, 300);
  // Never log the admin area.
  if (path && path.startsWith("/admin")) return ok();

  const ua = request.headers.get("user-agent") ?? "";
  const isBot = BOT_RE.test(ua);

  const geo = geoFromHeaders(request.headers);

  const row: Record<string, unknown> = {
    kind,
    visitor_class: classifyVisitor(geo),
    region: geo.region,
    city: geo.city,
    country: geo.country,
    path,
    session_id: clamp(body.sessionId, 64),
    // First-touch arrival channel (qr / share / host / newsletter / ref:host),
    // null for direct/untagged. Set on both views and outbound clicks so a row
    // is self-describing without joining back to the session's first view.
    src: clamp(body.src, 60),
    is_bot: isBot,
  };

  if (kind === "outbound") {
    const clickType =
      typeof body.clickType === "string" && VALID_CLICK.has(body.clickType)
        ? body.clickType
        : null;
    if (!clickType) return ok();
    row.click_type = clickType;
    row.event_id =
      typeof body.eventId === "string" && /^[0-9a-f-]{36}$/i.test(body.eventId)
        ? body.eventId
        : null;
    row.target_host = host(clamp(body.targetUrl, 500));
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    await supabase.from("site_events").insert(row);
  } catch (err) {
    console.error("track insert failed:", err);
  }

  return ok();
}
