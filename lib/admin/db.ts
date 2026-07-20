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

// Nav-badge count for rows where a column IS NULL (e.g. venues missing a blurb).
// Same never-throw contract as countPending. `idColumn` is the table's key, since
// some tables (hwy4_venues) have no `id`.
export async function countMissing(
  table: string,
  column: string,
  idColumn = "id"
): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const supabase = createClient(url, key);
  const { count } = await supabase
    .from(table)
    .select(idColumn, { count: "exact", head: true })
    .is(column, null);
  return count ?? 0;
}

// Nav-badge count for artist rows with a pending AI draft awaiting review: a
// staged blurb draft not yet published. An approximation of the page's "reviewable"
// set (it doesn't catch link-only finds), which is fine for a badge. Same
// never-throw contract as countMissing.
export async function countArtistDraftsPending(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const supabase = createClient(url, key);
  const { count } = await supabase
    .from("hwy4_artists")
    .select("artist_key", { count: "exact", head: true })
    .is("blurb", null)
    .not("blurb_draft", "is", null);
  return count ?? 0;
}

// Nav-badge count for rows missing EITHER of two columns (e.g. venues missing a
// blurb or a street address). A row missing both still counts once. Same
// never-throw contract as countMissing.
export async function countMissingEither(
  table: string,
  columnA: string,
  columnB: string,
  idColumn = "id"
): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return 0;
  const supabase = createClient(url, key);
  const { count } = await supabase
    .from(table)
    .select(idColumn, { count: "exact", head: true })
    .or(`${columnA}.is.null,${columnB}.is.null`);
  return count ?? 0;
}
