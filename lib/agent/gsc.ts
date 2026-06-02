import crypto from "node:crypto";

// Minimal, zero-dependency Google Search Console client. Signs a service-account
// JWT with Node's built-in crypto (no googleapis / google-auth-library), exchanges
// it for an access token, and queries the Search Analytics API. Returns null when
// the service account is not configured, so Stage 0 ships and runs before GSC exists.

export type GscRow = {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type ServiceAccount = { client_email: string; private_key: string };

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
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

/**
 * Pull query+page performance rows from Google Search Console for the trailing
 * `days` window (GSC data lags ~2 days, so the window ends 2 days ago).
 * Returns null when GOOGLE_SEARCH_CONSOLE_SA_JSON is unset (graceful no-op).
 */
export async function fetchGscRows(days = 28): Promise<GscRow[] | null> {
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

  const siteUrl =
    process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || "sc-domain:hwy4events.com";
  const token = await getAccessToken(sa);

  const day = 86_400_000;
  const endDate = new Date(Date.now() - 2 * day).toISOString().split("T")[0];
  const startDate = new Date(Date.now() - days * day).toISOString().split("T")[0];

  const resp = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      siteUrl
    )}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["query", "page"],
        rowLimit: 100,
      }),
    }
  );
  if (!resp.ok) {
    throw new Error(`GSC query failed: ${resp.status} ${await resp.text()}`);
  }
  const json = (await resp.json()) as {
    rows?: {
      keys: string[];
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }[];
  };
  return (json.rows ?? []).map((r) => ({
    query: r.keys[0] ?? "",
    page: r.keys[1] ?? "",
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}
