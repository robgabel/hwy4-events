import type { SupabaseClient } from "@supabase/supabase-js";
import {
  monthOverMonth,
  selectStrikingDistance,
  snapshotTotals,
  type DayPoint,
  type MonthOverMonth,
  type QueryRow,
  type StrikingQuery,
} from "./seo-insights";

// Server-side reads over seo_snapshots (service-role only) that shape the raw
// GSC captures into the insight the /admin/analytics Search panel and the Growth
// Agent both consume. Takes a Supabase client so both callers (the admin page's
// getAdminClientOrNull + the growth-context service client) reuse one definition.
//
// Every read is inherently bounded (date spine ≤ ~480 rows; each latest snapshot
// ≤ 500), so none can trip PostgREST's silent 1,000-row truncation as long as the
// query-snapshot reads stay pinned to a single captured_at. See seo-insights.ts.

export type PageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SeoOverview = {
  hasData: boolean;
  /** GSC date range covered by the trend spine. */
  window: { start: string; end: string } | null;
  /** When the latest query snapshot was captured. */
  capturedAt: string | null;
  totals: { clicks: number; impressions: number; ctr: number; avgPosition: number };
  mom: MonthOverMonth | null;
  /** Chronological daily points (the trend chart). */
  trend: DayPoint[];
  topQueries: QueryRow[];
  topPages: PageRow[];
  striking: StrikingQuery[];
};

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);

async function readDateSpine(supabase: SupabaseClient): Promise<DayPoint[]> {
  const { data } = await supabase
    .from("seo_snapshots")
    .select("data_date, clicks, impressions, position")
    .eq("dimension", "date")
    .order("data_date", { ascending: true });
  return ((data as Row[] | null) ?? [])
    .filter((r) => r.data_date)
    .map((r) => ({
      date: String(r.data_date),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      position: num(r.position),
    }));
}

/** Rows of the newest snapshot for a point-in-time dimension (query | page). */
async function readLatestSnapshot(
  supabase: SupabaseClient,
  dimension: "query" | "page"
): Promise<{ capturedAt: string | null; rows: Row[] }> {
  const { data: latest } = await supabase
    .from("seo_snapshots")
    .select("captured_at")
    .eq("dimension", dimension)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const capturedAt = (latest as { captured_at?: string } | null)?.captured_at ?? null;
  if (!capturedAt) return { capturedAt: null, rows: [] };

  const { data } = await supabase
    .from("seo_snapshots")
    .select("query, page, clicks, impressions, ctr, position")
    .eq("dimension", dimension)
    .eq("captured_at", capturedAt)
    .order("clicks", { ascending: false });
  return { capturedAt, rows: (data as Row[] | null) ?? [] };
}

export type SeoOverviewOpts = {
  topN?: number; // how many top queries/pages to return
  strikeLimit?: number;
};

export async function getSeoOverview(
  supabase: SupabaseClient,
  opts: SeoOverviewOpts = {}
): Promise<SeoOverview> {
  const topN = opts.topN ?? 12;

  const [spine, querySnap, pageSnap] = await Promise.all([
    readDateSpine(supabase),
    readLatestSnapshot(supabase, "query"),
    readLatestSnapshot(supabase, "page"),
  ]);

  const queries: QueryRow[] = querySnap.rows.map((r) => ({
    query: String(r.query ?? ""),
    clicks: num(r.clicks),
    impressions: num(r.impressions),
    ctr: num(r.ctr),
    position: num(r.position),
  }));
  const pages: PageRow[] = pageSnap.rows.map((r) => ({
    page: shortenPath(String(r.page ?? "")),
    clicks: num(r.clicks),
    impressions: num(r.impressions),
    ctr: num(r.ctr),
    position: num(r.position),
  }));

  const hasData = spine.length > 0 || queries.length > 0;

  return {
    hasData,
    window:
      spine.length > 0
        ? { start: spine[0].date, end: spine[spine.length - 1].date }
        : null,
    capturedAt: querySnap.capturedAt,
    totals: snapshotTotals(queries),
    mom: spine.length > 0 ? monthOverMonth(spine) : null,
    trend: spine,
    topQueries: queries.slice(0, topN),
    topPages: pages.slice(0, topN),
    striking: selectStrikingDistance(queries, { limit: opts.strikeLimit ?? 10 }),
  };
}

/** GSC returns fully-qualified page URLs; the panel + memo want the path. */
export function shortenPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}
