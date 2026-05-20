import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 60;

/**
 * Public read-only endpoint that returns the most recent dedup health snapshot.
 * Used by /admin/duplicates to render the stats banner without exposing the
 * service role key to the browser.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }
  const sb = createClient(url, anonKey);
  const { data, error } = await sb
    .from("hwy4_dedup_health")
    .select("snapshot_date, future_events, duplicate_groups, null_address_count, unknown_venue_count, candidates_pending, candidates_auto_merged")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshot: data ?? null });
}
