import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Attribution is best-effort. This route NEVER returns an error status to the
// client — a failed insert must not surface to a visitor. It logs one row per
// tracked landing into share_hits (service role; mirrors submit-event's write).

const VALID_SRC = new Set(["share", "qr", "pdf", "link", "download", "page"]);

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

  const slug = typeof body.slug === "string" ? body.slug.slice(0, 200) : null;
  const src =
    typeof body.src === "string" && VALID_SRC.has(body.src) ? body.src : null;
  const via = typeof body.via === "string" ? body.via.slice(0, 80) : null;
  const referrer =
    typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null;

  if (!slug || !src) return ok();

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    await supabase
      .from("share_hits")
      .insert({ event_slug: slug, src, via, referrer });
  } catch (err) {
    console.error("track-share insert failed:", err);
  }

  return ok();
}
