/**
 * Pure rules for the nightly event-link check (validate-urls.ts does the
 * fetching and the writes).
 *
 * 2026-09-28: visitmurphys.com timed out from the GitHub runner for one run,
 * and the checker read "could not connect" as "the page is gone". It nulled
 * all 135 visitmurphys.com links it checked, plus 4 others (three hosts that
 * never answered and one 503). Upcoming rows healed on the
 * next Visit Murphys scrape. Past rows never would have, and while the links
 * were gone, 18 GoCalaveras rows that Visit Murphys had merged into looked
 * GoCalaveras-owned to the armed stale sweep. The same false null hit one link
 * on 2026-09-30 and another on 2026-10-04; both pages were live.
 *
 * Nulling a link is destructive and nothing restores it on a past row, so
 * only a definitive answer from the server may cause it: a 404 or 410 that a
 * GET confirms. Everything else (no answer, a bot wall, a rate limit, a 5xx,
 * a refused HEAD) leaves the link alone and is reported instead.
 */

export type LinkVerdict = "ok" | "dead" | "unconfirmed";

/** The only HTTP answers that say the page does not exist. */
const DEAD_STATUSES = new Set([404, 410]);

/**
 * `status` is null when the request never got an HTTP answer at all: DNS,
 * connect, TLS or timeout. That is the checker's network failing as often as
 * the site, so it proves nothing.
 */
export function classifyLinkStatus(status: number | null): LinkVerdict {
  if (status === null) return "unconfirmed";
  if (DEAD_STATUSES.has(status)) return "dead";
  // 401/403/429 bot walls, 405 refused HEAD, 5xx outages: none of them say
  // the page is gone.
  if (status >= 400) return "unconfirmed";
  return "ok";
}

/**
 * HEAD is cheap, but some servers 404 a HEAD they would answer with a GET. A
 * HEAD that says "dead" is believed only when a GET agrees. `getStatus` is
 * ignored unless the HEAD said dead (the caller only issues the GET then).
 */
export function confirmedVerdict(
  headStatus: number | null,
  getStatus: number | null
): LinkVerdict {
  const head = classifyLinkStatus(headStatus);
  return head === "dead" ? classifyLinkStatus(getStatus) : head;
}

export interface LinkCheck {
  id: string;
  name: string;
  url: string;
  /** Final HTTP status the verdict rests on; null = no answer. */
  status: number | null;
  verdict: LinkVerdict;
}

/** Hostname without a leading "www.", so a host's links group together. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A host needs at least this many distinct answered links before the guard can judge it. */
export const HOST_ANOMALY_MIN_LINKS = 3;
/** At or above this share of a host's answered links answering "not found", spare the host. */
export const HOST_ANOMALY_DEAD_SHARE = 0.5;

export interface SparedHost {
  host: string;
  /** Distinct URLs that came back not-found. */
  dead: number;
  /** Distinct URLs that got an answer at all (ok or not-found). */
  answered: number;
}

export interface NullPlan {
  toNull: LinkCheck[];
  sparedHosts: SparedHost[];
}

/**
 * Which dead links to null. A host that answers "not found" for half or more
 * of its links in one run has a problem (a bot wall that 404s, a site move in
 * flight), not that many dead pages, so none of its links are nulled. Every
 * event it lists that is still real gets its link rewritten by the next
 * scrape anyway; a wrong null on a row no scraper rewrites is permanent.
 *
 * The share is over distinct URLs that got an answer. Several rows can share
 * one listing page (four Red Cross drives share one), and a link that got no
 * answer says nothing about whether the host's pages exist: counting it would
 * let a half-down host dilute its own 404s below the line.
 */
export function planLinkNulls(checks: readonly LinkCheck[]): NullPlan {
  const byHost = new Map<string, LinkCheck[]>();
  for (const c of checks) {
    const host = linkHost(c.url);
    const list = byHost.get(host);
    if (list) list.push(c);
    else byHost.set(host, [c]);
  }

  const toNull: LinkCheck[] = [];
  const sparedHosts: SparedHost[] = [];
  for (const [host, list] of byHost) {
    const dead = list.filter((c) => c.verdict === "dead");
    if (dead.length === 0) continue;
    const answered = new Set(
      list.filter((c) => c.verdict !== "unconfirmed").map((c) => c.url)
    );
    const deadUrls = new Set(dead.map((c) => c.url));
    if (
      answered.size >= HOST_ANOMALY_MIN_LINKS &&
      deadUrls.size / answered.size >= HOST_ANOMALY_DEAD_SHARE
    ) {
      sparedHosts.push({ host, dead: deadUrls.size, answered: answered.size });
      continue;
    }
    toNull.push(...dead);
  }
  return { toNull, sparedHosts };
}

/**
 * One line per host whose links went unconfirmed, so an outage reads as an
 * outage in the log ("visitmurphys.com 135 (no answer 135)") instead of
 * vanishing into a count.
 */
export function summarizeUnconfirmed(checks: readonly LinkCheck[]): string[] {
  const byHost = new Map<string, Map<string, number>>();
  for (const c of checks) {
    if (c.verdict !== "unconfirmed") continue;
    const host = linkHost(c.url) || "(bad url)";
    const reason = c.status === null ? "no answer" : `HTTP ${c.status}`;
    const reasons = byHost.get(host) ?? new Map<string, number>();
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    byHost.set(host, reasons);
  }
  return [...byHost.entries()]
    .map(([host, reasons]) => {
      const total = [...reasons.values()].reduce((a, b) => a + b, 0);
      const detail = [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `${r} ${n}`)
        .join(", ");
      return { host, total, line: `${host} ${total} (${detail})` };
    })
    .sort((a, b) => b.total - a.total || a.host.localeCompare(b.host))
    .map((x) => x.line);
}
