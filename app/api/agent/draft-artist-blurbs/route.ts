import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import {
  draftMissingArtistBlurbs,
  type DraftArtistsResult,
} from "@/lib/agent/draft-artist-blurbs";
import { SITE_URL } from "@/lib/constants";

// Daily self-healing artist/band-blurb drafter. Web-researches each upcoming
// live-music act named in an event's `artists` field. Split policy (standing
// rule — Rob, 2026-08-11): HIGH-confidence results auto-publish the live
// `blurb`/`genre`/`links` and this route Slack-informs; medium and below stage
// a pending draft (blurb_draft) for human review at /admin/artists. Sibling to
// /api/agent/draft-venue-addresses, which keeps the full human gate.
//
// `?limit=N` caps the batch (default 6 — each act is a ~15s web_search call, so the
// default stays well inside maxDuration). Idempotent + self-limiting: once every
// upcoming act has a draft, a published blurb, or a tried-marker, it's a no-op.

// Inform-only ping for auto-publishes (the rule is "just inform, don't ask").
// Best-effort, same shape as the other agent routes' Slack posts.
async function postAutoPublishSlack(result: DraftArtistsResult): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const names = result.artists.filter((a) => a.published).map((a) => a.name);
  const lines = [
    `*Band blurbs: ${names.length} auto-published (high confidence)*`,
    names.join(", "),
    `Medium and below are waiting for review → ${SITE_URL}/admin/artists`,
  ];
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
  } catch (err) {
    console.error("[draft-artist-blurbs] Slack post failed:", err);
  }
}

export const maxDuration = 300;

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 6;

  try {
    const result = await draftMissingArtistBlurbs({ limit });
    if (result.published > 0) await postAutoPublishSlack(result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[draft-artist-blurbs] failed:", err);
    return NextResponse.json({ error: "Artist blurb drafting failed" }, { status: 500 });
  }
}
