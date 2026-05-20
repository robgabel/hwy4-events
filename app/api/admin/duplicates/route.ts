import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/dedup-server";

export const maxDuration = 30;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // local dev
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("key") === secret;
}

interface CandidateRow {
  id: string;
  status: string;
  similarity: number;
  reason: string;
  created_at: string;
  event_a_id: string;
  event_b_id: string;
}

interface EventRow {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  town: string;
  venue_name: string | null;
  address: string | null;
  description: string | null;
  source_name: string | null;
  event_url: string | null;
  dedup_key: string | null;
  sources: unknown;
}

/**
 * GET /api/admin/duplicates?status=pending
 * Returns each candidate with the two referenced event rows hydrated.
 */
export async function GET(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";

  const sb = supabaseService();
  const { data: candidates, error } = await sb
    .from("hwy4_duplicate_candidates")
    .select("id, status, similarity, reason, created_at, event_a_id, event_b_id")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const eventIds = Array.from(
    new Set(
      (candidates ?? []).flatMap((c: CandidateRow) => [c.event_a_id, c.event_b_id])
    )
  );

  let events: EventRow[] = [];
  if (eventIds.length > 0) {
    const { data, error: evErr } = await sb
      .from("hwy4_events")
      .select(
        "id, name, date, start_time, town, venue_name, address, description, source_name, event_url, dedup_key, sources"
      )
      .in("id", eventIds);
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
    events = (data ?? []) as EventRow[];
  }

  const byId = new Map(events.map((e) => [e.id, e]));
  const hydrated = (candidates ?? []).map((c: CandidateRow) => ({
    ...c,
    event_a: byId.get(c.event_a_id) ?? null,
    event_b: byId.get(c.event_b_id) ?? null,
  }));

  return NextResponse.json({ candidates: hydrated });
}

/**
 * POST /api/admin/duplicates
 * Body: { candidate_id, action: "merge"|"reject", winner_id? }
 *   - merge: collapse the two rows. `winner_id` must match one of the pair;
 *     the other is deleted after smart-merge.
 *   - reject: mark the candidate as a false positive — never auto-flagged again.
 */
export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { candidate_id?: string; action?: string; winner_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { candidate_id, action, winner_id } = body;
  if (!candidate_id || (action !== "merge" && action !== "reject")) {
    return NextResponse.json({ error: "Missing candidate_id or action" }, { status: 400 });
  }

  const sb = supabaseService();
  const { data: candidate, error: candErr } = await sb
    .from("hwy4_duplicate_candidates")
    .select("id, status, event_a_id, event_b_id")
    .eq("id", candidate_id)
    .single();
  if (candErr || !candidate)
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (candidate.status !== "pending")
    return NextResponse.json({ error: `Already ${candidate.status}` }, { status: 409 });

  if (action === "reject") {
    const { error } = await sb
      .from("hwy4_duplicate_candidates")
      .update({ status: "rejected", resolved_by: "admin", resolved_at: new Date().toISOString() })
      .eq("id", candidate_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: "rejected" });
  }

  // merge
  if (!winner_id || (winner_id !== candidate.event_a_id && winner_id !== candidate.event_b_id)) {
    return NextResponse.json(
      { error: "winner_id must match event_a_id or event_b_id" },
      { status: 400 }
    );
  }
  const loserId = winner_id === candidate.event_a_id ? candidate.event_b_id : candidate.event_a_id;

  const { error: mergeErr } = await sb.rpc("hwy4_merge_event_pair", {
    p_candidate_id: candidate_id,
    p_winner_id: winner_id,
    p_loser_id: loserId,
    p_resolved_by: "admin",
  });
  if (mergeErr) return NextResponse.json({ error: mergeErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, action: "merged", winner_id, loser_id: loserId });
}
