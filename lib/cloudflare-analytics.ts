/**
 * Cloudflare Web Analytics (RUM) read client.
 *
 * hwy4events.com is served direct from Vercel (not proxied through Cloudflare),
 * so the only Cloudflare data for the site is the Web Analytics RUM beacon
 * (see components/CloudflareAnalytics.tsx). This module reads that data back out
 * via the GraphQL Analytics API: dataset `rumPageloadEventsAdaptiveGroups`,
 * account-level, filtered by siteTag. There is no zone-level data for this domain.
 *
 * Single source of truth for the app's CF analytics queries. Consumed by
 * /api/analytics (ad-hoc read) and /api/snapshot-analytics (daily persistence).
 * See PRD-cloudflare-analytics.md.
 *
 * Server-only — never import this into a client component, and never expose the
 * token. Env required:
 *   CLOUDFLARE_API_TOKEN              account-owned token, perm: Account Analytics -> Read
 *   CLOUDFLARE_ACCOUNT_ID            32-hex account tag
 *   CLOUDFLARE_WEB_ANALYTICS_SITE_TAG 32-hex Web Analytics site tag
 *
 * Sampling: the adaptive dataset is sampled; true counts = count * sampleInterval.
 * At this site's volume sampleInterval is ~1 so values match the dashboard, but we
 * multiply anyway so the numbers stay honest as traffic grows.
 */

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/** RUM dimensions we read, each a confirmed-valid field on the dataset. */
const DIMENSIONS = {
  requestPath: "requestPath",
  refererHost: "refererHost",
  countryName: "countryName",
  deviceType: "deviceType",
  userAgentBrowser: "userAgentBrowser",
} as const;
type Dimension = keyof typeof DIMENSIONS;

export interface DateRange {
  /** ISO-8601 inclusive lower bound, e.g. "2026-05-26T00:00:00Z". */
  since: string;
  /** ISO-8601 inclusive upper bound. */
  until: string;
}

export interface Totals {
  pageviews: number;
  visits: number;
}

export interface CountRow {
  /** Dimension value (page path, referrer host, country, device, browser). */
  key: string;
  pageviews: number;
  visits: number;
}

export interface AnalyticsSnapshot {
  range: DateRange;
  totals: Totals;
  topPages: CountRow[];
  referrers: CountRow[];
  countries: CountRow[];
  devices: CountRow[];
  browsers: CountRow[];
  /** Visit counts from answer engines, derived from referrers. Directional only. */
  aiReferrals: Record<string, number>;
}

interface CfCreds {
  token: string;
  accountTag: string;
  siteTag: string;
}

function getCreds(): CfCreds {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
  const siteTag = process.env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG;
  if (!token || !accountTag || !siteTag) {
    throw new Error(
      "Missing Cloudflare env (need CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_WEB_ANALYTICS_SITE_TAG)"
    );
  }
  // accountTag + siteTag are interpolated into the GraphQL query, so hard-validate
  // their shape (both are 32-hex Cloudflare identifiers). The token only ever rides
  // in the Authorization header.
  if (!/^[0-9a-f]{32}$/i.test(accountTag)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hex account tag");
  }
  if (!/^[0-9a-f]{32}$/i.test(siteTag)) {
    throw new Error("CLOUDFLARE_WEB_ANALYTICS_SITE_TAG must be a 32-character hex site tag");
  }
  return { token, accountTag, siteTag };
}

interface RumGroup {
  count: number;
  sum: { visits: number };
  avg: { sampleInterval: number };
  dimensions?: Record<string, string>;
}

/**
 * Run one `rumPageloadEventsAdaptiveGroups` query. Values interpolated into the
 * query are all trusted/validated (hex ids, ISO timestamps, an integer, and a
 * whitelisted dimension name), mirroring the calls validated against the live API.
 */
async function queryRum(
  creds: CfCreds,
  range: DateRange,
  dimension: Dimension | null,
  limit: number
): Promise<RumGroup[]> {
  const lim = Math.max(1, Math.min(Math.floor(limit), 1000));
  const dims = dimension ? `dimensions { ${DIMENSIONS[dimension]} }` : "";
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${creds.accountTag}" }) {
        rumPageloadEventsAdaptiveGroups(
          filter: { AND: [
            { datetime_geq: "${range.since}" },
            { datetime_leq: "${range.until}" },
            { siteTag: "${creds.siteTag}" }
          ] }
          limit: ${lim}
          orderBy: [count_DESC]
        ) {
          count
          sum { visits }
          avg { sampleInterval }
          ${dims}
        }
      }
    }
  }`;

  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Cloudflare GraphQL HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: {
      viewer?: { accounts?: Array<{ rumPageloadEventsAdaptiveGroups?: RumGroup[] }> };
    };
    errors?: Array<{ message: string }> | null;
  };
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `Cloudflare GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }
  return json.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];
}

/** Sampling-adjusted whole number. */
function adjust(value: number, sampleInterval: number | undefined): number {
  return Math.round(value * (sampleInterval && sampleInterval > 0 ? sampleInterval : 1));
}

function toRows(groups: RumGroup[], dimension: Dimension): CountRow[] {
  return groups.map((g) => ({
    key: g.dimensions?.[DIMENSIONS[dimension]] ?? "",
    pageviews: adjust(g.count, g.avg?.sampleInterval),
    visits: adjust(g.sum?.visits ?? 0, g.avg?.sampleInterval),
  }));
}

export async function getTotals(range: DateRange): Promise<Totals> {
  const rows = await queryRum(getCreds(), range, null, 1);
  const r = rows[0];
  if (!r) return { pageviews: 0, visits: 0 };
  return {
    pageviews: adjust(r.count, r.avg?.sampleInterval),
    visits: adjust(r.sum?.visits ?? 0, r.avg?.sampleInterval),
  };
}

export async function getTopPages(range: DateRange, limit = 25): Promise<CountRow[]> {
  return toRows(await queryRum(getCreds(), range, "requestPath", limit), "requestPath");
}

export async function getReferrers(range: DateRange, limit = 50): Promise<CountRow[]> {
  return toRows(await queryRum(getCreds(), range, "refererHost", limit), "refererHost");
}

export async function getGeography(range: DateRange, limit = 25): Promise<CountRow[]> {
  return toRows(await queryRum(getCreds(), range, "countryName", limit), "countryName");
}

export async function getDevices(range: DateRange, limit = 10): Promise<CountRow[]> {
  return toRows(await queryRum(getCreds(), range, "deviceType", limit), "deviceType");
}

export async function getBrowsers(range: DateRange, limit = 15): Promise<CountRow[]> {
  return toRows(await queryRum(getCreds(), range, "userAgentBrowser", limit), "userAgentBrowser");
}

/**
 * Answer-engine referral buckets. Directional only: Google AI Overviews referrals
 * arrive as `google.com` (indistinguishable from organic) and many AI clickthroughs
 * arrive as direct (no referrer), so this is a lower bound, not a complete count.
 * Search-side traffic (Google/Bing) is covered by GSC + Bing Webmaster, not here.
 */
const AI_ENGINES: Array<{ key: string; hosts: string[] }> = [
  { key: "chatgpt", hosts: ["chatgpt.com", "chat.openai.com"] },
  { key: "perplexity", hosts: ["perplexity.ai"] },
  { key: "gemini", hosts: ["gemini.google.com"] },
  { key: "copilot", hosts: ["copilot.microsoft.com"] },
  { key: "claude", hosts: ["claude.ai"] },
];

function hostMatches(host: string, engineHost: string): boolean {
  return host === engineHost || host.endsWith(`.${engineHost}`);
}

export function classifyAiReferrals(referrers: CountRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { key } of AI_ENGINES) out[key] = 0;
  for (const row of referrers) {
    const host = row.key.toLowerCase();
    if (!host) continue;
    for (const engine of AI_ENGINES) {
      if (engine.hosts.some((h) => hostMatches(host, h))) {
        out[engine.key] += row.visits;
        break;
      }
    }
  }
  return out;
}

/** Full snapshot for a range — used by the API route and the daily snapshot cron. */
export async function getAnalyticsSnapshot(range: DateRange): Promise<AnalyticsSnapshot> {
  const [totals, topPages, referrers, countries, devices, browsers] = await Promise.all([
    getTotals(range),
    getTopPages(range, 25),
    getReferrers(range, 50),
    getGeography(range, 25),
    getDevices(range, 10),
    getBrowsers(range, 15),
  ]);
  return {
    range,
    totals,
    topPages,
    referrers,
    countries,
    devices,
    browsers,
    aiReferrals: classifyAiReferrals(referrers),
  };
}

// --- date-range helpers ---------------------------------------------------

/** Trailing window of `n` days ending now. */
export function lastNDays(n: number, now: Date = new Date()): DateRange {
  const since = new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: now.toISOString() };
}

/** Full UTC day for a YYYY-MM-DD string. */
export function utcDayRange(day: string): DateRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`utcDayRange expects YYYY-MM-DD, got "${day}"`);
  }
  return { since: `${day}T00:00:00Z`, until: `${day}T23:59:59Z` };
}

export function utcAddDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`utcAddDays expects YYYY-MM-DD, got "${isoDate}"`);
  }
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- RUM spike guard ------------------------------------------------------
//
// rumPageloadEventsAdaptiveGroups can return a CAPPED day (~10,000 pageviews
// and ~10,000 visits) that is not real traffic. On 2026-09-01 that number
// landed in analytics_daily and the Friday growth memo narrated a Labor Day
// spike; the same day's referrer rows summed to tens of visits and first-party
// site_events had ~62 views. Blank beats a fake day: never invent a replacement
// count (unsampled RUM for old days is already gone).

/** Adaptive-groups ceiling we actually hit. A day at or above this is unusable. */
export const ADAPTIVE_GROUPS_CEILING = 10_000;

/**
 * Totals this many times the same snapshot's referrer-row visit sum are not a
 * real day (the Sep 1 cap: 10,000 visits vs tens of referrer visits). Requires
 * a positive referrer sum so a failed dimension fetch on a quiet day is not
 * itself a reject.
 */
export const REFERRER_MISMATCH_RATIO = 10;

export type RumRejectReason = "adaptive_groups_ceiling" | "referrer_mismatch";

export type RumSnapshotJudgment =
  | { reject: false }
  | { reject: true; reason: RumRejectReason };

export function referrerVisitSum(
  referrers: Array<{ visits?: number | null }> | null | undefined
): number {
  if (!referrers) return 0;
  let n = 0;
  for (const r of referrers) n += Number(r.visits) || 0;
  return n;
}

/**
 * Ingest-time verdict for one Cloudflare RUM day. Pure: the snapshot route
 * calls this before upsert, and the growth-context read path reuses the same
 * ceiling via `isUnusableAnalyticsDay`.
 */
export function judgeRumSnapshot(input: {
  pageviews: number;
  visits: number;
  referrers?: Array<{ visits?: number | null }> | null;
}): RumSnapshotJudgment {
  const pageviews = Number(input.pageviews) || 0;
  const visits = Number(input.visits) || 0;
  if (pageviews >= ADAPTIVE_GROUPS_CEILING || visits >= ADAPTIVE_GROUPS_CEILING) {
    return { reject: true, reason: "adaptive_groups_ceiling" };
  }
  const refVisits = referrerVisitSum(input.referrers);
  const claimed = Math.max(pageviews, visits);
  if (refVisits > 0 && claimed >= refVisits * REFERRER_MISMATCH_RATIO) {
    return { reject: true, reason: "referrer_mismatch" };
  }
  return { reject: false };
}

export type AnalyticsDailyWrite = {
  date: string;
  pageviews: number | null;
  visits: number | null;
  top_pages: CountRow[];
  referrers: CountRow[];
  countries: CountRow[];
  devices: CountRow[];
  browsers: CountRow[];
  ai_referrals: Record<string, number>;
  rejected: boolean;
  reject_reason: RumRejectReason | null;
};

/** Shape the snapshot cron upserts. Rejected days keep the row (gap visible) with null totals. */
export function buildAnalyticsDailyRow(
  day: string,
  snapshot: AnalyticsSnapshot
): AnalyticsDailyWrite {
  const verdict = judgeRumSnapshot({
    pageviews: snapshot.totals.pageviews,
    visits: snapshot.totals.visits,
    referrers: snapshot.referrers,
  });
  const dimensions = {
    date: day,
    top_pages: snapshot.topPages,
    referrers: snapshot.referrers,
    countries: snapshot.countries,
    devices: snapshot.devices,
    browsers: snapshot.browsers,
    ai_referrals: snapshot.aiReferrals,
  };
  if (verdict.reject) {
    return {
      ...dimensions,
      pageviews: null,
      visits: null,
      rejected: true,
      reject_reason: verdict.reason,
    };
  }
  return {
    ...dimensions,
    pageviews: snapshot.totals.pageviews,
    visits: snapshot.totals.visits,
    rejected: false,
    reject_reason: null,
  };
}

export type AnalyticsDayRead = {
  date: string;
  pageviews?: number | null;
  visits?: number | null;
  rejected?: boolean | null;
  top_pages?: unknown;
  ai_referrals?: Record<string, unknown> | null;
};

/** Read-path skip: rejected flag, null totals, or a still-stored ceiling day. */
export function isUnusableAnalyticsDay(row: AnalyticsDayRead): boolean {
  if (row.rejected) return true;
  if (row.pageviews == null || row.visits == null) return true;
  if (row.pageviews >= ADAPTIVE_GROUPS_CEILING || row.visits >= ADAPTIVE_GROUPS_CEILING) {
    return true;
  }
  return false;
}

export type CfTrafficWindows = {
  pageviews_7d: number;
  pageviews_prev_7d: number;
  days_included: number;
  days_included_prev: number;
  excluded_dates: string[];
  window_start: string;
  window_end: string;
  prev_window_start: string;
  prev_window_end: string;
};

/**
 * Sum Cloudflare pageviews over calendar 7-day windows, not "the newest 14
 * rows". Windows are complete UTC days ending yesterday (the snapshot cron
 * writes the previous UTC day). Rejected / null / ceiling days are skipped
 * and listed on `excluded_dates`.
 */
export function sumCfTrafficWindows(
  rows: AnalyticsDayRead[],
  today: string
): CfTrafficWindows {
  const windowEnd = utcAddDays(today, -1);
  const windowStart = utcAddDays(windowEnd, -6);
  const prevWindowEnd = utcAddDays(windowStart, -1);
  const prevWindowStart = utcAddDays(prevWindowEnd, -6);

  const byDate = new Map<string, AnalyticsDayRead>();
  for (const r of rows) {
    const d = String(r.date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) byDate.set(d, r);
  }

  const excluded: string[] = [];
  let pageviews7 = 0;
  let days7 = 0;
  let pageviewsPrev = 0;
  let daysPrev = 0;

  for (let d = windowStart; d <= windowEnd; d = utcAddDays(d, 1)) {
    const row = byDate.get(d);
    if (!row) continue;
    if (isUnusableAnalyticsDay(row)) {
      excluded.push(d);
      continue;
    }
    pageviews7 += row.pageviews ?? 0;
    days7++;
  }
  for (let d = prevWindowStart; d <= prevWindowEnd; d = utcAddDays(d, 1)) {
    const row = byDate.get(d);
    if (!row) continue;
    if (isUnusableAnalyticsDay(row)) {
      excluded.push(d);
      continue;
    }
    pageviewsPrev += row.pageviews ?? 0;
    daysPrev++;
  }

  return {
    pageviews_7d: pageviews7,
    pageviews_prev_7d: pageviewsPrev,
    days_included: days7,
    days_included_prev: daysPrev,
    excluded_dates: excluded.sort(),
    window_start: windowStart,
    window_end: windowEnd,
    prev_window_start: prevWindowStart,
    prev_window_end: prevWindowEnd,
  };
}
