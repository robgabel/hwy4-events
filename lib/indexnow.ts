/**
 * IndexNow: push new event URLs to Bing (and every engine sharing the
 * IndexNow pool) the day they appear, instead of waiting for a crawl (HWY-62).
 *
 * Events are perishable: a page that gets indexed after the event is worthless,
 * and ChatGPT search and Copilot lean on Bing's index. Best-effort by contract:
 * submitIndexNow never throws and never fails its caller; it reports counts.
 *
 * Spec: https://www.indexnow.org/documentation. One POST carries up to 10,000
 * URLs, all on the same host as the key. The key is public; we serve it at
 * KEY_PATH and pass that as keyLocation, which also scopes submissions to the
 * whole host (the key file sits at the root).
 */

import { generateEventSlug, townSlug } from "./slugs";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_MAX_URLS = 10_000;
export const KEY_PATH = "/indexnow-key.txt";

const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

/** The active key: env INDEXNOW_KEY wins, else the region default. Null when
 *  neither is a valid key, which turns IndexNow into a no-op. */
export function resolveIndexNowKey(
  envKey: string | undefined,
  regionKey: string | undefined
): string | null {
  for (const k of [envKey?.trim(), regionKey?.trim()]) {
    if (k && KEY_RE.test(k)) return k;
  }
  return null;
}

export type IndexNowPayload = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
};

/**
 * Pure: dedupe, keep only absolute http(s) URLs on the site's own host (the
 * protocol rejects a batch containing any other host), and split into
 * spec-sized batches.
 */
export function buildIndexNowPayloads(
  urls: readonly string[],
  siteUrl: string,
  key: string,
  max = INDEXNOW_MAX_URLS
): IndexNowPayload[] {
  let host: string;
  try {
    host = new URL(siteUrl).host;
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const list: string[] = [];
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    if (parsed.host !== host || !/^https?:$/.test(parsed.protocol)) continue;
    const href = parsed.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    list.push(href);
  }
  const keyLocation = `${siteUrl.replace(/\/$/, "")}${KEY_PATH}`;
  const out: IndexNowPayload[] = [];
  for (let i = 0; i < list.length; i += max) {
    out.push({ host, key, keyLocation, urlList: list.slice(i, i + max) });
  }
  return out;
}

export type IndexNowResult = {
  submitted: number;
  batches: number;
  /** HTTP status per batch (0 = network error). 200/202 are success. */
  statuses: number[];
  ok: boolean;
  skipped?: "no_key" | "no_urls";
};

type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number }>;

/** Submit URLs. Never throws; a failed batch is recorded as its status. */
export async function submitIndexNow(
  urls: readonly string[],
  opts: { siteUrl: string; key: string | null; fetchImpl?: Fetcher; log?: (line: string) => void }
): Promise<IndexNowResult> {
  const log = opts.log ?? ((line: string) => console.log(`[indexnow] ${line}`));
  if (!opts.key) {
    log("skipped: no IndexNow key configured");
    return { submitted: 0, batches: 0, statuses: [], ok: true, skipped: "no_key" };
  }
  const payloads = buildIndexNowPayloads(urls, opts.siteUrl, opts.key);
  if (payloads.length === 0) {
    log("skipped: no URLs to submit");
    return { submitted: 0, batches: 0, statuses: [], ok: true, skipped: "no_urls" };
  }
  const doFetch: Fetcher = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const statuses: number[] = [];
  let submitted = 0;
  for (const p of payloads) {
    let status = 0;
    try {
      const res = await doFetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(p),
      });
      status = res.status;
    } catch (err) {
      log(`batch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    statuses.push(status);
    if (status === 200 || status === 202) submitted += p.urlList.length;
  }
  const ok = statuses.every((s) => s === 200 || s === 202);
  log(`submitted ${submitted} URL(s) in ${payloads.length} batch(es); statuses ${statuses.join(",")}`);
  return { submitted, batches: payloads.length, statuses, ok };
}

export type IndexNowEventRow = { name: string; date: string; town: string };

/**
 * The daily submission list: every event created in the window (new pages
 * nobody has crawled yet), the hub pages whose content those events change
 * (homepage, the temporal + live-music lists), and the town page of each town
 * that gained an event, when that town has a published page. Updated-at is not
 * used: it changes on most rows every day, so it would resubmit the catalog.
 */
export function collectIndexNowUrls(
  rows: readonly IndexNowEventRow[],
  siteUrl: string,
  opts: { hubPaths: readonly string[]; publishedTownSlugs: ReadonlySet<string> }
): string[] {
  const base = siteUrl.replace(/\/$/, "");
  if (rows.length === 0) return [];
  const urls = rows.map((r) => `${base}/events/${generateEventSlug(r.name, r.date, r.town)}`);
  for (const p of opts.hubPaths) urls.push(p === "/" ? `${base}/` : `${base}${p}`);
  const towns = new Set(rows.map((r) => townSlug(r.town)));
  for (const t of towns) if (opts.publishedTownSlugs.has(t)) urls.push(`${base}/towns/${t}`);
  return urls;
}
