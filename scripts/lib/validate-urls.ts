import { supabaseAdmin } from "./supabase-admin.js";
import { isUnstableHost } from "../../lib/event-link.js";
import {
  classifyLinkStatus,
  confirmedVerdict,
  planLinkNulls,
  summarizeUnconfirmed,
  type LinkCheck,
  type LinkVerdict,
} from "./url-check.js";

const BATCH_SIZE = 5; // concurrent requests
const TIMEOUT_MS = 10000;
const BATCH_DELAY_MS = 500; // delay between batches to avoid rate limiting
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/** The HTTP status of one request, or null when no answer came back at all. */
async function requestStatus(
  url: string,
  method: "HEAD" | "GET"
): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    // Only the status matters; don't download the page.
    await resp.body?.cancel().catch(() => {});
    return resp.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** One link's verdict. A HEAD that says dead is only believed once a GET agrees. */
async function checkUrl(
  url: string
): Promise<{ status: number | null; verdict: LinkVerdict }> {
  const headStatus = await requestStatus(url, "HEAD");
  const headSaysDead = classifyLinkStatus(headStatus) === "dead";
  const getStatus = headSaysDead ? await requestStatus(url, "GET") : null;
  return {
    status: headSaysDead ? getStatus : headStatus,
    verdict: confirmedVerdict(headStatus, getStatus),
  };
}

/**
 * Check the links on upcoming events and null the ones that are provably
 * gone, so a dead page doesn't reach the briefing or the detail page.
 *
 * The rules live in url-check.ts: only a 404 or 410 that a GET confirms
 * counts as dead. No answer, a bot wall, a rate limit or a 5xx never nulls a
 * link, and a host where half or more of its answered links come back "not
 * found" is spared as a host problem. Past events are not checked: no scraper
 * rewrites their links, so a wrong null there is permanent.
 */
export async function validateEventUrls(): Promise<{
  checked: number;
  broken: number;
  nulled: number;
  unconfirmed: number;
}> {
  console.log("\n=== URL Validation ===");

  const today = new Date().toISOString().slice(0, 10);
  const { data: events, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, event_url")
    .not("event_url", "is", null)
    .gte("date", today)
    .order("date", { ascending: true });

  if (error) {
    console.error("Failed to fetch events for URL validation:", error.message);
    return { checked: 0, broken: 0, nulled: 0, unconfirmed: 0 };
  }

  if (!events || events.length === 0) {
    console.log("No upcoming events with URLs to validate");
    return { checked: 0, broken: 0, nulled: 0, unconfirmed: 0 };
  }

  // Skip hosts we can't server-validate and don't render anyway (bot-walled
  // aggregators like GoCalaveras — see lib/event-link.ts). A 403 from them is
  // not a dead link, and the resolver never surfaces these URLs, so nulling
  // them would be a false positive that also destroys provenance.
  const skippedAggregator = events.filter(
    (e) => e.event_url && isUnstableHost(e.event_url)
  ).length;
  const checkable = events.filter(
    (e): e is { id: string; name: string; event_url: string } =>
      !!e.event_url && !isUnstableHost(e.event_url)
  );

  console.log(
    `Checking ${checkable.length} upcoming event links (${skippedAggregator} aggregator URLs skipped)...`
  );

  // One request per distinct URL (several rows can share a listing page),
  // in batches to avoid overwhelming servers.
  const urls = [...new Set(checkable.map((e) => e.event_url))];
  const byUrl = new Map<string, { status: number | null; verdict: LinkVerdict }>();
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(checkUrl));
    batch.forEach((url, j) => byUrl.set(url, results[j]));

    if (i + BATCH_SIZE < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  const checks: LinkCheck[] = checkable.map((e) => ({
    id: e.id,
    name: e.name,
    url: e.event_url,
    ...byUrl.get(e.event_url)!,
  }));

  const dead = checks.filter((c) => c.verdict === "dead");
  const unconfirmed = checks.filter((c) => c.verdict === "unconfirmed");
  const plan = planLinkNulls(checks);

  for (const h of plan.sparedHosts) {
    console.warn(
      `  HOST_ANOMALY ${h.host}: ${h.dead} of ${h.answered} answered links came back not-found this run. ` +
        "Treating it as a host problem, not dead pages; none nulled."
    );
  }

  let nulled = 0;
  for (const c of plan.toNull) {
    console.log(`  DEAD (${c.status}): ${c.name} → ${c.url}`);
    // Only null the link we checked; if anything rewrote it since, leave it.
    // Count rows actually changed, not calls that didn't error (HWY-33).
    const { data: changed, error: updateError } = await supabaseAdmin
      .from("hwy4_events")
      .update({ event_url: null })
      .eq("id", c.id)
      .eq("event_url", c.url)
      .select("id");
    if (updateError) {
      console.warn(`  Failed to null URL for event ${c.id}:`, updateError.message);
    } else if ((changed ?? []).length > 0) {
      nulled++;
    }
  }

  for (const line of summarizeUnconfirmed(checks)) {
    console.log(`  Unconfirmed, kept: ${line}`);
  }

  console.log(
    `URL validation: ${checks.length} checked (${urls.length} distinct URLs), ${dead.length} dead, ${nulled} nulled, ` +
      `${unconfirmed.length} unconfirmed (kept)` +
      (plan.sparedHosts.length > 0
        ? `, ${plan.sparedHosts.length} host(s) spared by the anomaly guard`
        : "") +
      (skippedAggregator > 0 ? `, ${skippedAggregator} aggregator URLs skipped` : "")
  );
  return {
    checked: checks.length,
    broken: dead.length,
    nulled,
    unconfirmed: unconfirmed.length,
  };
}
