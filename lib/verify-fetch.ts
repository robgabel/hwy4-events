/**
 * Canonical-page fetch for `/api/verify-events`.
 *
 * A failed fetch is a source outage, not evidence the event is missing. HWY-52:
 * on 2026-08-12 `https://www.murphyswinebar.com/events` (Murphys Wine & Beer
 * Garden) did not come back, and the verifier stamped the two events it was
 * checking `needs_verification` with "Could not fetch canonical events page".
 * That status is excluded from re-checks, so the blip sat in the human queue
 * until a chief-of-staff digest filed the ticket. The page itself 301s to
 * `https://murphyswinebar.com/events/` and still strips to a dated WordPress
 * listing (reproduced 2026-09-30).
 *
 * This module retries transient failures, refuses to treat an unreachable or
 * date-less page as a verdict, and builds the Slack line that names the org.
 */

/** Exact reason written before HWY-52. Stuck rows match this string. */
export const CANONICAL_FETCH_FAILURE_REASON =
  "Could not fetch canonical events page; flag for manual review.";

export const CANONICAL_FETCH_ATTEMPTS = 2;
export const CANONICAL_FETCH_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 750;
const TEXT_CAP = 12_000;

const MONTH =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/**
 * A year-bearing date. Month+day without a year ("Sept 30th" in a hours
 * footer) and a bare "Oct 2026" do not count. Both survive on a page whose
 * event list failed to render.
 */
const DATED_LISTING_RE = new RegExp(
  `\\b(?:\\d{1,2}/\\d{1,2}/\\d{4}|\\d{4}-\\d{2}-\\d{2}|(?:${MONTH})\\.?\\s+\\d{1,2},?\\s+\\d{4})\\b`,
  "i"
);

export function isCanonicalFetchFailure(reason: string | null | undefined): boolean {
  return reason === CANONICAL_FETCH_FAILURE_REASON;
}

/** 404/410 are permanent. Everything else (5xx, 429, 403, timeout) may be a blip. */
export function shouldRetryCanonicalStatus(status: number): boolean {
  return status !== 404 && status !== 410;
}

export function stripCanonicalHtml(html: string): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > TEXT_CAP ? text.slice(0, TEXT_CAP) + "…" : text;
}

export type CanonicalPageAssessment =
  | { ok: true }
  | { ok: false; kind: "empty" | "no_dates"; error: string };

/** The model may judge a page only when a year-bearing date survives the strip. */
export function assessCanonicalText(text: string | null | undefined): CanonicalPageAssessment {
  const body = (text ?? "").trim();
  if (body.length < 80) {
    return { ok: false, kind: "empty", error: "page stripped to almost no text" };
  }
  if (!DATED_LISTING_RE.test(body)) {
    return {
      ok: false,
      kind: "no_dates",
      error: "no year-bearing event date survived the tag strip",
    };
  }
  return { ok: true };
}

export type CanonicalFetcher = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; redirect: "follow" }
) => Promise<{ ok: boolean; status: number; url?: string; text: () => Promise<string> }>;

export type CanonicalFetchSuccess = {
  ok: true;
  text: string;
  attempts: number;
  finalUrl: string;
};

export type CanonicalFetchFailure = {
  ok: false;
  kind: "http" | "network" | "empty" | "no_dates";
  error: string;
  attempts: number;
  status?: number;
  finalUrl?: string;
};

export type CanonicalFetchResult = CanonicalFetchSuccess | CanonicalFetchFailure;

export async function fetchCanonicalPage(
  url: string,
  opts: {
    userAgent: string;
    fetchImpl?: CanonicalFetcher;
    attempts?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<CanonicalFetchResult> {
  const fetchImpl: CanonicalFetcher = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? CANONICAL_FETCH_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? CANONICAL_FETCH_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let last: CanonicalFetchFailure = {
    ok: false,
    kind: "network",
    error: "no attempt",
    attempts: 0,
  };

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchImpl(url, {
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) {
        last = {
          ok: false,
          kind: "http",
          error: `HTTP ${res.status}`,
          status: res.status,
          attempts: i,
          finalUrl: res.url,
        };
        if (i < attempts && shouldRetryCanonicalStatus(res.status)) {
          await sleep(RETRY_DELAY_MS * i);
          continue;
        }
        return last;
      }
      const text = stripCanonicalHtml(await res.text());
      const assessment = assessCanonicalText(text);
      if (!assessment.ok) {
        last = {
          ok: false,
          kind: assessment.kind,
          error: assessment.error,
          attempts: i,
          finalUrl: res.url,
        };
        // An empty body can be a truncated response. A full page with no
        // dates is the structure itself; retrying it will not grow a listing.
        if (assessment.kind === "empty" && i < attempts) {
          await sleep(RETRY_DELAY_MS * i);
          continue;
        }
        return last;
      }
      return { ok: true, text, attempts: i, finalUrl: res.url || url };
    } catch (err) {
      last = {
        ok: false,
        kind: "network",
        error: err instanceof Error ? err.message : String(err),
        attempts: i,
      };
      if (i < attempts) {
        await sleep(RETRY_DELAY_MS * i);
        continue;
      }
      return last;
    }
  }
  return last;
}

export function canonicalFetchAlert(args: {
  displayName: string;
  url: string;
  failure: CanonicalFetchFailure;
}): string {
  const { displayName, url, failure } = args;
  const who = `*${displayName}* (${url})`;
  if (failure.kind === "empty" || failure.kind === "no_dates") {
    return (
      `⚠️ Verification read ${who} but ${failure.error}. ` +
      `No events were flagged. The page structure may have changed; ` +
      `the next run retries.`
    );
  }
  return (
    `⚠️ Verification could not reach ${who} after ${failure.attempts} attempt(s): ${failure.error}. ` +
    `No events were flagged. This is a source outage, not a date mismatch; ` +
    `the next run retries.`
  );
}

/** Greppable one-liner, same idiom as URL_DATE_CORRECTION / DEGRADED_INSERT_HELD. */
export function canonicalUnreachableLog(args: {
  slug: string;
  url: string;
  failure: CanonicalFetchFailure;
}): string {
  const status = args.failure.status != null ? ` status=${args.failure.status}` : "";
  return (
    `[verify-events] CANONICAL_UNREACHABLE slug=${args.slug} url=${args.url} ` +
    `kind=${args.failure.kind} attempts=${args.failure.attempts}${status} ` +
    `error=${args.failure.error}`
  );
}
