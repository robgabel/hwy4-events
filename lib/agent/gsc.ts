import crypto from "node:crypto";
import { REGION_OPS } from "../region-ops";

// Minimal, zero-dependency Google Search Console client. Signs a service-account
// JWT with Node's built-in crypto (no googleapis / google-auth-library), exchanges
// it for an access token, and queries the Search Analytics API. Returns null when
// the service account is not configured, so Stage 0 ships and runs before GSC exists.

export type GscMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscQueryRow = GscMetrics & { query: string };
export type GscPageRow = GscMetrics & { page: string };
export type GscDateRow = GscMetrics & { date: string };

/** The three dimension cuts one collector run pulls. */
export type GscCuts = {
  /** Window the query/page cuts summarize (inclusive GSC dates). */
  startDate: string;
  endDate: string;
  /** Daily time series over the window — the durable, upsertable trend spine. */
  byDate: GscDateRow[];
  /** Top queries over the window (top-clicks first). */
  byQuery: GscQueryRow[];
  /** Top pages over the window (top-clicks first). */
  byPage: GscPageRow[];
};

type ServiceAccount = { client_email: string; private_key: string };

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SEARCH_CONSOLE_SA_JSON;
  if (!raw) return null;
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SEARCH_CONSOLE_SA_JSON is not valid JSON");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_SEARCH_CONSOLE_SA_JSON missing client_email / private_key");
  }
  return sa;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(sa.private_key, "base64url");
  const assertion = `${signingInput}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!resp.ok) {
    throw new Error(`GSC token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  const json = (await resp.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("GSC token exchange returned no access_token");
  return json.access_token;
}

function siteUrl(): string {
  return (
    process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL ||
    REGION_OPS.seo.gscPropertyDefault
  );
}

type RawRow = {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/** One Search Analytics query for a single dimension over [startDate, endDate]. */
async function querySearchAnalytics(
  token: string,
  dimension: "date" | "query" | "page",
  startDate: string,
  endDate: string,
  rowLimit: number
): Promise<RawRow[]> {
  const resp = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      siteUrl()
    )}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate, endDate, dimensions: [dimension], rowLimit }),
    }
  );
  if (!resp.ok) {
    throw new Error(
      `GSC ${dimension} query failed: ${resp.status} ${await resp.text()}`
    );
  }
  const json = (await resp.json()) as { rows?: RawRow[] };
  return json.rows ?? [];
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().split("T")[0];
}

/**
 * Pull the three dimension cuts (date / query / page) from Google Search Console.
 *
 * - `windowDays` bounds the query/page top-lists and the daily-run trend refresh.
 *   GSC data lags ~2 days, so the window ends 2 days ago.
 * - `historyDays` (defaults to `windowDays`) bounds ONLY the by-date time series,
 *   letting a one-time backfill seed many months of daily history in a single call
 *   while daily runs re-pull just the trailing window (GSC revises recent days).
 *
 * Returns null when GOOGLE_SEARCH_CONSOLE_SA_JSON is unset (graceful no-op).
 */
export async function fetchGscCuts(
  windowDays = 28,
  historyDays = windowDays
): Promise<GscCuts | null> {
  const sa = loadServiceAccount();
  if (!sa) return null;

  const token = await getAccessToken(sa);
  const endDate = isoDaysAgo(2);
  const startDate = isoDaysAgo(windowDays);
  const historyStart = isoDaysAgo(historyDays);

  const [dateRows, queryRows, pageRows] = await Promise.all([
    querySearchAnalytics(token, "date", historyStart, endDate, 1000),
    querySearchAnalytics(token, "query", startDate, endDate, 500),
    querySearchAnalytics(token, "page", startDate, endDate, 500),
  ]);

  const metrics = (r: RawRow): GscMetrics => ({
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  });

  return {
    startDate,
    endDate,
    byDate: dateRows.map((r) => ({ date: r.keys?.[0] ?? "", ...metrics(r) })),
    byQuery: queryRows.map((r) => ({ query: r.keys?.[0] ?? "", ...metrics(r) })),
    byPage: pageRows.map((r) => ({ page: r.keys?.[0] ?? "", ...metrics(r) })),
  };
}
