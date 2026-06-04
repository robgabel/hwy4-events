/**
 * Cloudflare Web Analytics smoke test / credential checker.
 *
 * Standalone by design: the Next app's lib/ and this scripts/ workspace are
 * separate module roots (see tsconfig "exclude": ["scripts"]), so — matching the
 * project's cross-root convention — this re-issues the GraphQL query directly
 * rather than importing lib/cloudflare-analytics.ts. Keep the query shape in sync
 * with that module; this file only exists to verify connectivity + credentials.
 *
 * Usage (from the scripts/ workspace, which has tsx):
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_WEB_ANALYTICS_SITE_TAG=… \
 *     npx tsx cf-analytics-smoke.ts
 *
 * Prints last-7-day totals + top referrers and flags any answer-engine traffic.
 */

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function gql(token: string, query: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as {
    data?: { viewer?: { accounts?: Array<{ groups?: RumGroup[] }> } };
    errors?: Array<{ message: string }> | null;
  };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data?.viewer?.accounts?.[0]?.groups ?? [];
}

interface RumGroup {
  count: number;
  sum: { visits: number };
  dimensions?: { refererHost?: string };
}

const AI_HOSTS = ["chatgpt.com", "chat.openai.com", "perplexity.ai", "gemini.google.com", "copilot.microsoft.com", "claude.ai"];

async function main() {
  const token = requireEnv("CLOUDFLARE_API_TOKEN");
  const accountTag = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const siteTag = requireEnv("CLOUDFLARE_WEB_ANALYTICS_SITE_TAG");

  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  const window = `{ AND: [ { datetime_geq: "${since.toISOString()}" }, { datetime_leq: "${until.toISOString()}" }, { siteTag: "${siteTag}" } ] }`;

  const totals = await gql(
    token,
    `{ viewer { accounts(filter: { accountTag: "${accountTag}" }) {
        groups: rumPageloadEventsAdaptiveGroups(filter: ${window}, limit: 1) {
          count sum { visits }
        } } } }`
  );
  const t = totals[0];
  console.log("\nCloudflare Web Analytics — last 7 days");
  console.log("  pageviews:", t?.count ?? 0);
  console.log("  visits:   ", t?.sum?.visits ?? 0);

  const referrers = await gql(
    token,
    `{ viewer { accounts(filter: { accountTag: "${accountTag}" }) {
        groups: rumPageloadEventsAdaptiveGroups(filter: ${window}, limit: 25, orderBy: [count_DESC]) {
          count sum { visits } dimensions { refererHost }
        } } } }`
  );

  console.log("\n  top referrers:");
  for (const r of referrers) {
    const host = r.dimensions?.refererHost || "(direct)";
    console.log(`    ${String(r.sum?.visits ?? 0).padStart(5)}  ${host}`);
  }

  const ai = referrers
    .filter((r) => {
      const h = (r.dimensions?.refererHost || "").toLowerCase();
      return AI_HOSTS.some((x) => h === x || h.endsWith(`.${x}`));
    })
    .reduce((sum, r) => sum + (r.sum?.visits ?? 0), 0);
  console.log(`\n  answer-engine referrals (top-25 sample): ${ai}`);
  console.log("\nOK — token, account, and site tag all valid.\n");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err.message);
  process.exit(1);
});
