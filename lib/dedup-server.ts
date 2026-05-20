/**
 * Server-side helpers for dedup detection and health reporting.
 *
 * This file mirrors the normalization rules in scripts/lib/dedup.ts but is
 * Postgres-side: detection runs in a single SQL query so it scales without
 * round-tripping every row through Node.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function supabaseService(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase service credentials");
  }
  return createClient(url, key);
}

/**
 * Identify pairs of future events that share the same simplified name +
 * same date but live under different dedup_keys. Phase 1 dedup_key derivation
 * catches the bulk of duplicates; this picks up the residue where the place
 * anchor diverged (e.g. one source has an unrecognized venue label).
 *
 * Returns the new candidate count.
 */
export async function detectCandidates(
  sb: SupabaseClient
): Promise<{ inserted: number; pairs: { event_a_id: string; event_b_id: string; reason: string }[] }> {
  const { data, error } = await sb.rpc("hwy4_detect_duplicate_candidates");
  if (error) throw error;
  const rows = (data ?? []) as { event_a_id: string; event_b_id: string; reason: string; inserted: boolean }[];
  return {
    inserted: rows.filter((r) => r.inserted).length,
    pairs: rows,
  };
}
