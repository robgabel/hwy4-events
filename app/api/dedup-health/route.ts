import { NextResponse } from "next/server";
import { supabaseService, detectCandidates } from "@/lib/dedup-server";

export const maxDuration = 60;

/**
 * Daily dedup health snapshot.
 *
 * 1. Runs the duplicate-candidate detector (inserts new pairs into the queue).
 * 2. Writes a row into hwy4_dedup_health for today.
 *
 * Schedule via vercel.json. Bearer-protected by CRON_SECRET when set.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseService();

    const detection = await detectCandidates(sb);

    const { data: snapshot, error: snapErr } = await sb
      .rpc("hwy4_snapshot_dedup_health")
      .single();
    if (snapErr) throw snapErr;

    return NextResponse.json({
      ok: true,
      detection: { evaluated: detection.pairs.length, inserted: detection.inserted },
      snapshot,
    });
  } catch (err) {
    console.error("[dedup-health]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
