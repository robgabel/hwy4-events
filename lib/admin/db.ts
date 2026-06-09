import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Single service-role Supabase client for every /admin page and server action.
// Replaces the ~18 hand-rolled getServiceClient/serviceClient/inline copies that
// used to live in each admin file. Service role bypasses RLS by design; the whole
// /admin tree is gated by Basic Auth in middleware.ts.
//
// Use getAdminClient() in server actions (a missing env there is a real fault —
// throw). Use getAdminClientOrNull() in read-only page loaders that should
// degrade to an empty list rather than 500 on a misconfigured env.
export function getAdminClientOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function getAdminClient(): SupabaseClient {
  const client = getAdminClientOrNull();
  if (!client) throw new Error("Missing Supabase service credentials");
  return client;
}

// Nav-badge count. Returns 0 (never throws) when creds are missing so the admin
// layout can't crash on a misconfigured env — a missing badge is fine, a 500 on
// every admin page is not.
export async function countPending(
  table: string,
  column: string,
  value: string
): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const supabase = createClient(url, key);
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  return count ?? 0;
}
