import { normalizeName } from "./event-identity";
import { extractUrls, isTicketResaleHost } from "./description-quality";

/**
 * Pure data-plausibility checks for the daily /api/check-events audit.
 * Born from the 2026-07-16 persona QA passes: every bug found that day was
 * visible in data the system already had — the audit checked *completeness*
 * (missing venue, invalid category) but not *plausibility*. These close that:
 *
 *  - findImpossibleTimes:      "1:00 AM – 1:00 AM", "7:00 PM – 2:00 PM", and
 *                              lone small-hours starts. The write path
 *                              (scripts/lib/dedup.ts normalizeEventTimes) now
 *                              drops the provably-impossible shapes, but the
 *                              three raw-insert writers bypass it — this audit
 *                              is the backstop that covers every write path.
 *  - findCategoryInconsistencies: one production carrying several categories
 *                              across its rows ("What the Constitution Means
 *                              to Me" ran as kids + fine_arts + other).
 *  - findSuspectTicketLinks:   a ticket-selling link in description text whose
 *                              host we do not recognize. The sanitizer strips
 *                              KNOWN resale marketplaces outright (HWY-11);
 *                              this is the other half, so a reseller that is
 *                              not on the list yet surfaces for a human
 *                              instead of quietly overcharging a reader.
 *  - findTimelessNearDupes:    same-day same-venue rows where at least one has
 *                              no start time. NULL-start rows can never share a
 *                              dedup bucket (by design — the festival umbrella
 *                              pattern relies on it), so this class of dupe
 *                              (Kane Brown / the Moose "District 8" triple) is
 *                              invisible to every merge layer and needs a human.
 *
 * Locked by scripts/test/audit-checks.test.ts.
 */

export interface AuditRow {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  category: string | null;
  description: string | null;
  status: string | null;
}

export interface ImpossibleTime {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  reason: "zero_length" | "end_before_start" | "small_hours_start";
}

export interface CategoryInconsistency {
  normalized_name: string;
  venue_name: string | null;
  categories: string[];
  count: number;
  ids: string[];
}

export interface SuspectTicketLink {
  id: string;
  name: string;
  date: string;
  url: string;
  host: string;
  reason: "known_resale" | "unrecognized_ticket_host";
}

export interface TimelessNearDupe {
  date: string;
  venue_name: string;
  names: string[];
  ids: string[];
}

// Hosts we have verified as an organizer, venue, or primary ticket seller for
// this corridor. A description link to any of these is expected and quiet.
// Grow this list rather than the resale denylist when a new legitimate seller
// shows up — the point of the check is that an UNKNOWN ticket host gets looked
// at once by a person.
const KNOWN_TICKET_HOSTS = [
  "ticketmaster.com",
  "livenation.com",
  "eventbrite.com",
  "ticketleap.com",
  "onecau.se",
  "onecause.com",
  "brownpapertickets.com",
  "tickettailor.com",
  "squareup.com",
  "shopify.com",
  "ironstonevineyards.com",
  "bricestation.com",
  "bearvalleymusicfestival.org",
];

// A URL only counts as "ticket-selling" if it says so. Plain organizer links
// (murphyscreektheatre.org/spirit-song) are not the target and stay quiet.
const TICKETY_URL = /(ticket|seats?|boxoffice|box-office|admission|rsvp|register)/i;

function urlHost(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
}

function isKnownTicketHost(host: string): boolean {
  return KNOWN_TICKET_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Ticket-ish links in description text pointing at a host we have not vetted.
 *  Advisory only: a human either adds the host to KNOWN_TICKET_HOSTS or, if it
 *  is a reseller, to TICKET_RESALE_HOSTS so the sanitizer strips it from then
 *  on. `known_resale` should never appear once the sanitizer has run over a
 *  row; if it does, that row predates the scrub and needs a backfill. */
export function findSuspectTicketLinks(rows: AuditRow[]): SuspectTicketLink[] {
  const out: SuspectTicketLink[] = [];
  for (const r of active(rows)) {
    for (const url of extractUrls(r.description)) {
      const host = urlHost(url);
      if (!host) continue;
      if (isTicketResaleHost(host)) {
        out.push({ id: r.id, name: r.name, date: r.date, url, host, reason: "known_resale" });
      } else if (TICKETY_URL.test(url) && !isKnownTicketHost(host)) {
        out.push({
          id: r.id,
          name: r.name,
          date: r.date,
          url,
          host,
          reason: "unrecognized_ticket_host",
        });
      }
    }
  }
  return out;
}

function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function active(rows: AuditRow[]): AuditRow[] {
  return rows.filter((r) => r.status !== "cancelled");
}

/** Times that are provably wrong or wrong-until-proven-otherwise. */
export function findImpossibleTimes(rows: AuditRow[]): ImpossibleTime[] {
  const out: ImpossibleTime[] = [];
  for (const r of active(rows)) {
    const s = timeToMinutes(r.start_time);
    const e = timeToMinutes(r.end_time);
    const base = {
      id: r.id,
      name: r.name,
      date: r.date,
      start_time: r.start_time,
      end_time: r.end_time,
    };
    if (s !== null && e !== null && s === e) {
      out.push({ ...base, reason: "zero_length" });
    } else if (s !== null && e !== null && e < s && e > 3 * 60) {
      // A genuine overnight event ends by ~3 AM; a later-yet-before-start end
      // (a festival's closing-day matinee squashed into opening night) is noise.
      out.push({ ...base, reason: "end_before_start" });
    } else if (s !== null && s > 0 && s < 6 * 60) {
      // A lone 12:01–5:59 AM start is almost always a scrape artifact, but a
      // rare owl walk / fun-run staging is conceivable — so this is a WATCH
      // flag for a human, never auto-corrected. Midnight exactly (00:00) is
      // excluded: NYE events legitimately start there.
      out.push({ ...base, reason: "small_hours_start" });
    }
  }
  return out;
}

/** One production, several categories: same normalized title + venue appearing
 *  with >1 distinct category across its rows. */
export function findCategoryInconsistencies(rows: AuditRow[]): CategoryInconsistency[] {
  const groups = new Map<string, AuditRow[]>();
  for (const r of active(rows)) {
    if (!r.category) continue;
    const key = `${normalizeName(r.name)}|${(r.venue_name ?? "").toLowerCase().trim()}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const out: CategoryInconsistency[] = [];
  for (const list of groups.values()) {
    const cats = [...new Set(list.map((r) => r.category as string))];
    if (list.length > 1 && cats.length > 1) {
      out.push({
        normalized_name: normalizeName(list[0].name),
        venue_name: list[0].venue_name,
        categories: cats.sort(),
        count: list.length,
        ids: list.map((r) => r.id),
      });
    }
  }
  return out;
}

// Tokens too common to signal identity on their own.
const STOP_TOKENS = new Set([
  "the", "a", "an", "at", "of", "and", "in", "on", "for", "with",
  "live", "music", "night", "event", "series", "show",
]);

function significantTokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t))
  );
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** ≥2 of a title's significant tokens appearing in the other row's description
 *  (or all of them, for one-token titles like a bare band name ≥5 chars). */
function nameTokensInText(name: string, text: string | null): boolean {
  if (!text) return false;
  const tokens = [...significantTokens(name)];
  if (tokens.length === 0) return false;
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const hits = tokens.filter((t) => haystack.includes(` ${t} `)).length;
  if (tokens.length === 1) return tokens[0].length >= 5 && hits === 1;
  return hits >= 2;
}

/** Same date + same venue, at least one row timeless, and an identity hint
 *  between some pair (≥2 shared significant title tokens, or one row's title
 *  appearing inside the other's description — the Kane Brown shape, where the
 *  umbrella row's description names the act). Advisory: a human disposes. */
export function findTimelessNearDupes(rows: AuditRow[]): TimelessNearDupe[] {
  const groups = new Map<string, AuditRow[]>();
  for (const r of active(rows)) {
    const venue = (r.venue_name ?? "").toLowerCase().trim();
    if (!venue) continue;
    const key = `${r.date}|${venue}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const out: TimelessNearDupe[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    if (!list.some((r) => timeToMinutes(r.start_time) === null)) continue;
    // Look for an identity hint on any pair involving a timeless row.
    let hinted = false;
    for (let i = 0; i < list.length && !hinted; i++) {
      for (let j = i + 1; j < list.length && !hinted; j++) {
        const a = list[i];
        const b = list[j];
        if (timeToMinutes(a.start_time) !== null && timeToMinutes(b.start_time) !== null) continue;
        if (sharedTokenCount(significantTokens(a.name), significantTokens(b.name)) >= 2) {
          hinted = true;
        } else if (
          // One row's title tokens showing up in the other's description — the
          // Kane Brown shape: the umbrella row's blurb names the act.
          nameTokensInText(a.name, b.description) ||
          nameTokensInText(b.name, a.description)
        ) {
          hinted = true;
        }
      }
    }
    if (hinted) {
      out.push({
        date: list[0].date,
        venue_name: list[0].venue_name as string,
        names: list.map((r) => r.name),
        ids: list.map((r) => r.id),
      });
    }
  }
  return out;
}
