/**
 * The passage an answer engine can lift from an event page (HWY-60).
 *
 * Engines pull one self-contained sentence and check it against other sources.
 * Our facts used to live only in a <dl>, and "About This Event" is usually the
 * same scraped prose the aggregator carries, so there was nothing quotable and
 * nothing we added. This builds one deterministic lead from structured fields:
 *
 *   "Ironstone Summer Concert Series is at Ironstone Amphitheatre in Murphys,
 *    CA on Saturday, August 16, 2026 at 7 PM. Kane Brown is on the bill.
 *    Tickets from $59."
 *
 * No LLM. Every clause is optional and drops when its field is unknown, because
 * blank beats wrong. Pure (no React, no date-fns) so scripts/ tests import it.
 */

import { REGION } from "./region";

export type AnswerEvent = {
  name: string;
  date: string; // YYYY-MM-DD
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  town: string;
  category?: string | null;
  artists?: string[] | null;
  status?: string | null;
  price?: string | null;
  cost_tier?: string | null;
  sold_out?: boolean | null;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-08-16" -> "Saturday, August 16, 2026", or null for a bad date. */
export function longDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[mo - 1]} ${d}, ${y}`;
}

/** "19:00:00" -> "7 PM", "19:30" -> "7:30 PM", junk -> null. */
export function spokenTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const meridiem = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0 ? `${h12} ${meridiem}` : `${h12}:${m[2]} ${meridiem}`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&rsquo;": "\u2019",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

/** Scraped names sometimes arrive HTML-escaped ("Diggin&#039;s"). */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|quot|#0?39|apos|rsquo|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** A trailing "– October 17, 2026" (organizers date their occurrence titles)
 *  repeats the date the sentence already states, so it comes off the name. */
function stripTitleDate(name: string): string {
  return name
    .replace(
      new RegExp(`\\s*[-\u2013\u2014:,]?\\s*(?:${MONTHS.join("|")})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\s*$`, "i"),
      ""
    )
    .trim();
}

/** "A", "A and B", "A, B and C", capped with "and more". */
function listActs(acts: string[], max = 3): string {
  const shown = acts.slice(0, max);
  const more = acts.length > max;
  if (more) return `${shown.join(", ")} and more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** True when any act already appears in the event name as a whole phrase (no
 *  need to repeat it). Word-bounded, so a short act like "Ty" doesn't match
 *  inside "Party". */
function nameCarriesActs(name: string, acts: string[]): boolean {
  const lower = ` ${name.toLowerCase().replace(/['\u2019]s\b/g, "").replace(/[^a-z0-9&']+/g, " ")} `;
  return acts.some((a) => {
    const phrase = a.toLowerCase().replace(/[^a-z0-9&']+/g, " ").trim();
    return phrase.length > 0 && lower.includes(` ${phrase} `);
  });
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

const TICKETED = new Set(["live_music", "festival", "fine_arts"]);
const BARE_AMOUNT = /^\$\s*(\d+(?:\.\d{1,2})?)$/;
const RANGE = /^\$\s*(\d+(?:\.\d{1,2})?)\s*(?:-|\u2013|to)\s*\$?\s*(\d+(?:\.\d{1,2})?)$/i;

/**
 * The price clause, or null when we can't state one honestly. Only a bare
 * amount ("$25") or a bare range ("$59 - $129") becomes a sentence; anything
 * with words around the number ("$20 to register a car, free to spectators",
 * "$25+", "$5 parking") is left to the Price row, which shows it verbatim.
 */
export function priceClause(e: AnswerEvent): string | null {
  if (e.sold_out) return "Tickets are sold out.";
  if (e.cost_tier === "free") return "Admission is free.";
  if (e.cost_tier === "donation") return "Admission is by donation.";
  if (e.cost_tier !== "paid" || !e.price) return null;
  const price = e.price.replace(/,/g, "").trim();
  const noun = TICKETED.has(e.category ?? "") ? "Tickets" : "Cost";
  const bare = BARE_AMOUNT.exec(price);
  if (bare) {
    return noun === "Tickets"
      ? `Tickets are ${money(Number(bare[1]))}.`
      : `Cost is ${money(Number(bare[1]))}.`;
  }
  const range = RANGE.exec(price);
  if (range) {
    const lo = Math.min(Number(range[1]), Number(range[2]));
    const hi = Math.max(Number(range[1]), Number(range[2]));
    if (lo === hi) return noun === "Tickets" ? `Tickets are ${money(lo)}.` : `Cost is ${money(lo)}.`;
    return `${noun} from ${money(lo)} to ${money(hi)}.`;
  }
  return null;
}

/**
 * The lead passage. Returns null only when even the core sentence can't be
 * built (no usable date), so the page renders nothing rather than a fragment.
 */
export function buildEventAnswer(e: AnswerEvent, today?: string): string | null {
  const name = stripTitleDate(decodeEntities(e.name).trim()).replace(/[.:;,\-\u2013]+$/, "").trim();
  const when = longDate(e.date);
  if (!name || !when) return null;

  const town = e.town.trim();
  const venue = decodeEntities(e.venue_name ?? "").trim();
  const place = town ? `${town}, ${REGION.stateCode}` : null;
  // A venue that is just the town ("Arnold", "Arnold, California") is a
  // locality, not a venue, and would read "at Arnold, California in Arnold, CA".
  const venueLower = venue.toLowerCase();
  const townLower = town.toLowerCase();
  const showVenue =
    venue && venueLower !== townLower && !venueLower.startsWith(`${townLower},`);
  // Detail pages stay up after the date; don't describe a past event as upcoming.
  const verb = today && e.date < today ? "was" : "is";

  let where = "";
  if (showVenue && place) where = ` at ${venue} in ${place}`;
  else if (showVenue) where = ` at ${venue}`;
  else if (place) where = ` in ${place}`;

  const start = spokenTime(e.start_time);
  const end = spokenTime(e.end_time);
  const clock = start ? (end && end !== start ? ` from ${start} to ${end}` : ` at ${start}`) : "";

  const parts = [`${name} ${verb}${where} on ${when}${clock}.`];

  if (e.status === "tentative" && verb === "is") parts.push("The date is tentative.");

  const acts = (e.artists ?? []).map((a) => a.trim()).filter(Boolean);
  if (e.category === "live_music" && acts.length > 0 && !nameCarriesActs(name, acts)) {
    const be = verb === "was" ? (acts.length === 1 ? "was" : "were") : acts.length === 1 ? "is" : "are";
    parts.push(`${listActs(acts.map(decodeEntities))} ${be} on the bill.`);
  }

  const price = verb === "is" ? priceClause(e) : null;
  if (price) parts.push(price);

  return parts.join(" ");
}

/**
 * Was this "verified" earned against the organizer's page? `verified` is also
 * written by a human Confirm in /admin/verification (often on an event the
 * page did NOT list, like weekly trivia), by publishing a community
 * submission, and by seed scripts. None of those checked a site, so only a
 * reason the verifier or the apply-organizer-time action wrote counts. A null
 * reason is ambiguous (seeds, submissions) and never counts.
 */
export function isOrganizerPageCheck(reason: string | null | undefined): boolean {
  const r = reason?.trim();
  if (!r) return false;
  if (/^(manually confirmed|confirmed by|dismissed|hidden)/i.test(r)) return false;
  return true;
}

/** Possessive that reads right for names ending in "s" ("Murphys' site"). */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** A timestamptz as a long civil date in the region's timezone. */
export function civilDate(ts: string | null | undefined, timeZone = REGION.timezone): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/**
 * The visible trust line for an event /api/verify-events confirmed against the
 * organizer's own page. Null unless the row is verified AND we know when, so the
 * page never claims a check it can't date.
 */
export function buildVerifiedLine(opts: {
  verificationStatus: string | null | undefined;
  verificationReason: string | null | undefined;
  checkedAt: string | null | undefined;
  orgName: string | null | undefined;
}): string | null {
  if (opts.verificationStatus !== "verified") return null;
  if (!isOrganizerPageCheck(opts.verificationReason)) return null;
  const when = civilDate(opts.checkedAt);
  if (!when) return null;
  const org = opts.orgName?.trim();
  const whose = org ? `${possessive(org)} site` : "the organizer's site";
  return `Checked against ${whose} on ${when}.`;
}
