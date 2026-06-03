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
