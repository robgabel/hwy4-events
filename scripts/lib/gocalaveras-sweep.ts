/**
 * GoCalaveras retraction — the AGGREGATOR half of the window-scoped stale sweep
 * (HWY-21, 2026-08-11). Pure: the DB half is stale-sweep-exec.ts, the shared
 * primitive and every guardrail are in stale-sweep.ts.
 *
 * Why an aggregator needs its own ownership test. The organizer sweeps
 * (murphys-irish-pub, sequoia-woods) retract what a venue stopped asserting
 * about its own calendar, and a venue is the last word on its own bookings.
 * GoCalaveras is a weaker witness three ways: it re-lists other people's
 * events, its rows are the ones organizer scrapers merge into, and it is the
 * single source that touches every venue in the corridor — so a bad rule here
 * has corridor-wide blast radius, not one venue's. The ownership test below is
 * therefore strictly narrower than an organizer's: a row is GoCalaveras's to
 * retract only when nothing about it suggests someone else now maintains it.
 *
 * `org_slug` alone cannot answer that. It is written only on INSERT
 * (scripts/lib/dedup.ts), never on update or merge, while `buildStrongMatchUpdate`
 * DOES overwrite `event_url` and `source_event_id` when an organizer scraper
 * merges into a resident row. So `org_slug='gocalaveras'` means "GoCalaveras
 * inserted this row once", not "GoCalaveras still owns it" — the merged row
 * carries the organizer's key and permalink, and its GoCalaveras id is gone
 * from the row entirely. Sweeping on the org_slug filter alone would delete
 * live organizer-maintained events the moment the aggregator's own listing
 * expired.
 *
 * Completeness. The sweep window may only cover dates a run provably read in
 * full. GoCalaveras is EventON: one AJAX POST per month with `fixed_month` /
 * `fixed_year` plus a `focus_start_date_range`/`focus_end_date_range` unix pair,
 * answered by one unpaginated JSON array of that month's events, each with a
 * stable numeric `event_id`. That is a bounded forward enumeration with stable
 * ids — the precondition HWY-21 set. But an EventON month payload can also lie
 * by omission in two ways this module refuses to trust:
 *   1. The response ignores the requested month and echoes another one (a stale
 *      nonce, a shortcode key the plugin stopped honoring). Every resident row
 *      in the month we THINK we read would then look retracted at once.
 *      `provenMonthLabel` requires the payload's own event dates to land inside
 *      the month we asked for.
 *   2. The calendar shortcode caps how many events it will return, so a busy
 *      month comes back truncated and the tail looks retracted.
 *      `detectShortcodeCap` reads the cap off the shortcode the page handed us
 *      and refuses any month that reaches it.
 * A month that fails either test contributes no window, exactly like a failed
 * or thin month view in sweepWindowsFromMonths.
 *
 * Bias: under-sweep. Every rule here fails toward leaving a row alone, because
 * a missed retraction is a stale card (visible, fixable, already the status quo)
 * while a wrong retraction deletes a real event off the site.
 */

import { isManuallyManagedEvent } from "./manual-sources.js";
import {
  monthWindowFromLabel,
  sweepWindowsFromMonths,
  type SweepRow,
  type SweepWindow,
} from "./stale-sweep.js";

export const GOCALAVERAS_ORG_SLUG = "gocalaveras";

/** EventON's own event id, as scripts/scrapers/gocalaveras.ts writes it:
 *  `String(ev.event_id)`, bare digits ("191902"). Every other scheme in the
 *  catalog is prefixed or slug-shaped (`murphys-irish-pub|open-mic-night-…`,
 *  `sequoia-woods|2026-08-14|…`, a Shopify handle), so a non-numeric id is
 *  positive proof another source has claimed the row's identity. */
const EVENTON_ID = /^\d+$/;

/** Own host only. Deliberately NOT lib/event-link's `isUnstableHost`: that set
 *  is "aggregators whose links we won't call durable" and may grow, and a
 *  second aggregator's URL must never read as GoCalaveras-owned. */
const OWN_HOSTS = new Set(["gocalaveras.com", "www.gocalaveras.com"]);

/**
 * Below this many enumerated events a month payload is not trusted to be the
 * whole month. Counts the RAW county-wide enumeration, not the corridor subset.
 *
 * NOT the shared primitive's default of 3: that number is calibrated for a
 * single venue, where three entries is a plausible month. A county aggregator's
 * live months run 136 / 114 / 60 / 13 / 16 / 4 across the six-month request,
 * so a floor of 3 would declare a 4-listing far-future month "fully read" — and
 * a 4-listing payload is exactly where a truncated response and a genuinely
 * quiet month are indistinguishable. 15 sits above that whole thin tail.
 * Consequence, on purpose: the far-future months contribute NO window until
 * their listings fill in, so retraction lags there rather than guessing.
 */
export const MIN_EVENTS_PER_MONTH = 15;

/** Share of a month payload's event dates that must fall inside the month we
 *  asked for before we believe the response is that month. Not 100%: EventON
 *  answers a focus range, so a multi-day event that started in the prior month
 *  legitimately appears with an earlier start date. */
export const MONTH_AGREEMENT_MIN_SHARE = 2 / 3;

/** Share of enumerated listings that must yield a permalink before slug keys
 *  count as observable this run. See slugExtractionHealthy. */
export const MIN_SLUG_EXTRACTION_SHARE = 0.5;

/** Parse a stored URL as one of ours, or null. http(s) only: a stored
 *  `javascript:` value parses cleanly and would otherwise pass a bare hostname
 *  check (the lib/url.ts allowlist rule, applied to identity instead of hrefs). */
function ownUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return OWN_HOSTS.has(u.hostname.toLowerCase()) ? u : null;
}

/** True only for an http(s) URL served by gocalaveras.com itself. A lookalike
 *  host ("gocalaveras.com.example.net") is not a match — exact host, no suffix
 *  test. */
export function isGoCalaverasUrl(url: string | null | undefined): boolean {
  return ownUrl(url) !== null;
}

/**
 * Permalink slug of a GoCalaveras event URL ("…/events/hot-copper-car-show/"
 * → "hot-copper-car-show"), or null for anything that is not an event page.
 *
 * ANCHORED to `/events/<slug>`, and everything after `<slug>` is ignored,
 * because EventON appends an occurrence tail to a recurring series' permalink:
 * `/events/mimosa-sundays-at-ironstone-vineyards/var/ri-13.l-L1` is live in the
 * catalog. Keying on the LAST segment there is wrong twice over — "ri-13.l-l1"
 * is a key the feed's own listing never produces (so the row reads as retracted
 * on a run where it is plainly still listed), and it is IDENTICAL for every
 * series that happens to share an occurrence index, so one event's presence
 * would spare an unrelated one. Anchoring fixes both ends at once: the resident
 * row and the batch entry reduce to the same series slug.
 *
 * This is a SECONDARY key, used alongside the numeric id, and it is deliberately
 * loose: EventON reuses one slug across every occurrence of a recurring series,
 * so a series with any occurrence still listed keeps all of its resident rows
 * alive. That under-sweeps a cancelled single night of a live series, which is
 * the direction to fail in — and it is what protects a row whose EventON id was
 * re-issued (recurring instances do get new ids) from reading as retracted.
 */
export function goCalaverasSlug(url: string | null | undefined): string | null {
  const u = ownUrl(url);
  if (!u) return null;
  const segments = u.pathname.split("/").filter(Boolean);
  // Only an event page keys a row: a bare "/events/" is the listing index, and
  // "/things-to-do/wineries/" is not an event at all.
  if (segments[0] !== "events" || segments.length < 2) return null;
  const slug = segments[1];
  try {
    return decodeURIComponent(slug).toLowerCase();
  } catch {
    // Malformed percent-escape in scraped data — the raw segment still keys it.
    return slug.toLowerCase();
  }
}

/** The EventON id when the row carries one, else null. */
function eventOnId(sid: string | null | undefined): string | null {
  const v = (sid ?? "").trim();
  return EVENTON_ID.test(v) ? v : null;
}

/** One event as the month payload enumerated it, before any of our filters. */
export interface EnumeratedEvent {
  id: string | number;
  url?: string | null;
}

/**
 * Which key classes this run could actually observe. Numeric ids come straight
 * off the JSON payload, so enumerating a month observes every one of them.
 * Slugs are lifted from the response HTML by a regex (extractUrlsFromHtml) and
 * are best-effort: a markup change silently drops them, which would make every
 * row that has ONLY a slug key look retracted at once.
 */
export interface ObservedKeys {
  slugs: boolean;
}

/**
 * Did this run's permalink extraction work well enough to trust slug keys?
 * The rows this gates are exactly the ones that depend on it: id-less legacy
 * rows, keyable only by slug.
 */
export function slugExtractionHealthy(
  enumerated: readonly EnumeratedEvent[]
): boolean {
  if (enumerated.length === 0) return false;
  const withSlug = enumerated.filter((e) => goCalaverasSlug(e.url) !== null).length;
  return withSlug / enumerated.length >= MIN_SLUG_EXTRACTION_SHARE;
}

/**
 * Is this resident row GoCalaveras's to retract? The executor has already
 * filtered to `org_slug='gocalaveras'`; this is everything that filter cannot
 * tell us. ALL must hold:
 *
 *  1. Its `source_event_id` is a bare EventON id, or absent. Any other scheme
 *     is an organizer scraper's key, written over ours by a merge.
 *  2. Its `event_url` is absent or on gocalaveras.com. An organizer domain
 *     means either that same merge, or an EventON listing whose only link is
 *     the organizer's own site (`_evcal_exlink`) — indistinguishable from the
 *     merge using the columns a sweep sees, so both are left alone.
 *  3. An id-less row must actually YIELD a key — a permalink that reduces to a
 *     series slug (not merely a gocalaveras.com URL: `/things-to-do/wineries/`
 *     and a bare `/events/` produce nothing) — and this run's permalink
 *     extraction must have worked (`observed.slugs`). A row with no usable key
 *     can never be proven present, so an aggregator sweep would select it every
 *     single run purely for being unkeyed. (The pub sweep does retract key-less
 *     rows: there the key-less rows WERE the invented phantoms, at one
 *     single-tenant venue. Corridor-wide, that same rule is a shredder.)
 *  4. It is not at a manually-managed venue (manual-sources.ts). The scraper
 *     filters those out of its batch before upsert, so their ids never enter
 *     the presence set and a legacy resident row at one would look permanently
 *     retracted. Belt-and-braces: those rows should not carry this org_slug at
 *     all.
 */
export function ownsGoCalaverasRow(row: SweepRow, observed: ObservedKeys): boolean {
  if (isManuallyManagedEvent({ name: row.name, venue_name: row.venue_name })) {
    return false;
  }
  if (row.event_url && !isGoCalaverasUrl(row.event_url)) return false;
  const id = eventOnId(row.source_event_id);
  if (!id) {
    // No usable id: the permalink must reduce to a real key, and this run must
    // have been able to read permalinks at all. "Has a gocalaveras.com URL" is
    // NOT enough — a URL that yields no slug leaves the row owned with zero
    // keys, which is precisely the never-matchable shape rule 3 exists to keep
    // out of the selection.
    if ((row.source_event_id ?? "").trim() !== "") return false;
    return observed.slugs && goCalaverasSlug(row.event_url) !== null;
  }
  return true;
}

/** Keys that mark a resident row present in this run's enumeration. */
export function goCalaverasRowKeys(row: SweepRow): (string | null)[] {
  return [eventOnId(row.source_event_id), goCalaverasSlug(row.event_url)];
}

/**
 * Presence set for a run: every key the feed asserted, from EVERY month it
 * fetched — including months that failed the completeness proof. Presence only
 * ever spares a row, so a half-read month's ids are still worth having.
 */
export function goCalaverasPresenceKeys(
  enumerated: readonly EnumeratedEvent[]
): Set<string> {
  const keys = new Set<string>();
  for (const e of enumerated) {
    const id = eventOnId(String(e.id));
    if (id) keys.add(id);
    const slug = goCalaverasSlug(e.url);
    if (slug) keys.add(slug);
  }
  return keys;
}

/** What one month's AJAX call produced, from the scraper's point of view. */
export interface MonthEnumeration {
  /** The month this run ASKED for, e.g. "August 2026". */
  requested: string;
  /** True only when the call returned a parsed `status: "GOOD"` payload. */
  ok: boolean;
  /** Every event start date (YYYY-MM-DD) in the payload, pre-filter. */
  dates: string[];
  /** Display cap declared by the calendar shortcode, when one was detected. */
  cap?: number | null;
}

/** Shortcode keys that could cap how many events a month returns. Matched by
 *  shape rather than a hardcoded name: the live shortcode comes off the page's
 *  `data-sc` attribute and its exact keys are the plugin's to change. A false
 *  positive here only withholds windows, which is the safe direction. */
const CAP_KEY = /count|limit/i;

/**
 * Smallest positive integer cap declared by the calendar shortcode, or null.
 * EventON's own "0" means unlimited, so only values > 0 count.
 */
export function detectShortcodeCap(
  shortcode: Record<string, unknown> | null | undefined
): { key: string; value: number } | null {
  let best: { key: string; value: number } | null = null;
  for (const [key, raw] of Object.entries(shortcode ?? {})) {
    if (!CAP_KEY.test(key)) continue;
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) continue;
    if (!best || value < best.value) best = { key, value };
  }
  return best;
}

/**
 * The month label to hand the shared window builder, or null when this month's
 * payload did not prove it covered the month we asked for. See the header for
 * the two lies a month payload can tell.
 */
export function provenMonthLabel(month: MonthEnumeration): string | null {
  if (!month.ok) return null;
  const bounds = monthWindowFromLabel(month.requested);
  if (!bounds) return null;
  if (month.dates.length === 0) return null;
  if (month.cap && month.cap > 0 && month.dates.length >= month.cap) return null;
  const inside = month.dates.filter(
    (d) => d >= bounds.from && d <= bounds.to
  ).length;
  if (inside / month.dates.length < MONTH_AGREEMENT_MIN_SHARE) return null;
  return month.requested;
}

/**
 * Sweepable windows for a GoCalaveras run: the proven months only, clamped to
 * today by the shared primitive (which also applies the thin-payload floor, so
 * the min-events rule stays defined in exactly one place).
 */
export function goCalaverasSweepWindows(
  months: readonly MonthEnumeration[],
  today: string
): SweepWindow[] {
  return sweepWindowsFromMonths(
    months.map((m) => ({
      label: provenMonthLabel(m),
      eventCount: m.dates.length,
    })),
    today,
    MIN_EVENTS_PER_MONTH
  );
}
