// Honest accounting for GoCalaveras detail-page enrichment (roadmap ticket HWY-32).
//
// The bug this exists for: on 2026-09-04 (Actions run 33872667002) every single
// `enrich:` line reported HTTP 429, and the run's summary still printed
// "Enriched 130/130 events from detail pages" — because that line counted
// ATTEMPTS, not successes. So the one signal that would have surfaced a total
// enrichment outage read as a perfect score.
//
// It matters beyond the log line. The month AJAX feed alone often carries no
// description, no poster, no location name and no address; the detail page is
// where all of that comes from. A silent 429 wall means new rows land in that
// degraded shape, which is what fed the Arnold Angels location red runs (the
// write-path half shipped in PR #275).
//
// Same rule as the scrape_runs writer and the serial update path: a sensor that
// can fail silently is not a sensor.
//
// Pure by design — no fetch, no clock, no DB — so scripts/test/enrich-report.test.ts
// can pin the counting, the warning threshold, the backoff and the circuit
// breaker without touching the network.

/** What one detail-page fetch actually did. */
export type EnrichOutcome =
  /** 2xx and the page yielded at least one field we wanted. */
  | "enriched"
  /** 2xx but nothing extractable (a redesign, or a genuinely bare listing). */
  | "empty"
  /** 429. The interesting one: the site is throttling us. */
  | "rate_limited"
  /** Any other non-2xx. */
  | "http_error"
  /** Transport threw (DNS, timeout, reset). */
  | "network_error"
  /** Never attempted, because the circuit breaker had already tripped. */
  | "skipped";

export interface EnrichTally {
  enriched: number;
  empty: number;
  rateLimited: number;
  httpError: number;
  networkError: number;
  skipped: number;
}

export const emptyTally = (): EnrichTally => ({
  enriched: 0,
  empty: 0,
  rateLimited: 0,
  httpError: 0,
  networkError: 0,
  skipped: 0,
});

export function tallyOutcome(t: EnrichTally, outcome: EnrichOutcome): void {
  switch (outcome) {
    case "enriched":
      t.enriched++;
      break;
    case "empty":
      t.empty++;
      break;
    case "rate_limited":
      t.rateLimited++;
      break;
    case "http_error":
      t.httpError++;
      break;
    case "network_error":
      t.networkError++;
      break;
    case "skipped":
      t.skipped++;
      break;
  }
}

/** Map an HTTP status to an outcome. 2xx is resolved by the caller (it depends
 *  on whether the page actually yielded fields), so this only covers failures. */
export function classifyStatus(status: number): Exclude<EnrichOutcome, "enriched" | "empty" | "skipped"> {
  return status === 429 ? "rate_limited" : "http_error";
}

export const attempted = (t: EnrichTally): number =>
  t.enriched + t.empty + t.rateLimited + t.httpError + t.networkError;

/** Warn once the throttled share of ATTEMPTS crosses this. Deliberately low:
 *  steady state is zero 429s, so even a fifth of a run being throttled means
 *  rows are landing without descriptions or posters. */
export const RATE_LIMIT_WARN_RATIO = 0.2;

/** Consecutive 429s that trip the breaker for the rest of the call. When the
 *  site is refusing everything, continuing costs the Action's 20-minute budget
 *  and buys nothing; enrichment re-runs daily, so partial coverage is fine and
 *  a fast, loud failure beats a slow, silent one. */
export const CIRCUIT_BREAK_CONSECUTIVE_429 = 12;

export const shouldTripCircuit = (
  consecutiveRateLimited: number,
  threshold: number = CIRCUIT_BREAK_CONSECUTIVE_429
): boolean => consecutiveRateLimited >= threshold;

/** How long to wait before the single retry, honoring `Retry-After` when the
 *  server sends a sane one. The header is seconds (delta-seconds form); an HTTP
 *  date, a missing value or an absurd one falls back, and everything is capped
 *  so one hostile header cannot park the whole scrape. */
export function retryDelayMs(
  retryAfter: string | null | undefined,
  fallbackMs: number,
  capMs: number
): number {
  const secs = retryAfter ? Number(retryAfter.trim()) : NaN;
  const fromHeader = Number.isFinite(secs) && secs >= 0 ? secs * 1000 : fallbackMs;
  return Math.min(Math.max(fromHeader, 0), capMs);
}

/** The summary line, and a warning when the run is not what "success" looks
 *  like. `total` is every event considered, including ones the breaker skipped. */
export function summarizeEnrichment(
  t: EnrichTally,
  total: number
): { line: string; warning: string | null } {
  const failed = t.rateLimited + t.httpError + t.networkError;
  const parts: string[] = [];
  if (t.empty) parts.push(`${t.empty} no detail fields`);
  if (t.rateLimited) parts.push(`${t.rateLimited} rate-limited (429)`);
  if (t.httpError) parts.push(`${t.httpError} http error`);
  if (t.networkError) parts.push(`${t.networkError} network error`);
  if (t.skipped) parts.push(`${t.skipped} skipped after circuit break`);

  // The count that leads is ENRICHED, not attempted. That inversion is the fix.
  const line =
    `  Enriched ${t.enriched}/${total} events from detail pages` +
    (parts.length ? ` (${parts.join(", ")})` : "");

  const tried = attempted(t);
  let warning: string | null = null;
  if (t.skipped > 0) {
    warning =
      `GoCalaveras enrichment CIRCUIT BROKE after ${t.rateLimited} rate-limited requests: ` +
      `${t.skipped} event(s) not enriched. New rows will land without detail ` +
      `descriptions, posters or addresses until this clears.`;
  } else if (tried > 0 && t.rateLimited / tried >= RATE_LIMIT_WARN_RATIO) {
    const pct = Math.round((t.rateLimited / tried) * 100);
    warning =
      `GoCalaveras rate-limited ${t.rateLimited}/${tried} enrichment requests (${pct}%). ` +
      `Rows enriched this run are incomplete; consider lowering ENRICH_CONCURRENCY further.`;
  } else if (total > 0 && t.enriched === 0) {
    warning =
      `GoCalaveras enrichment produced NOTHING for ${total} event(s). ` +
      `The detail-page markup may have changed.`;
  }
  return { line, warning };
}
