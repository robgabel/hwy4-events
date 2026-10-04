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
  const lower = ` ${name.toLowerCase().replace(/[^a-z0-9&']+/g, " ")} `;
  return acts.some((a) => {
    const phrase = a.toLowerCase().replace(/[^a-z0-9&']+/g, " ").trim();
    return phrase.length > 0 && lower.includes(` ${phrase} `);
  });
}

/** Dollar amounts stated in a free-text price, in order of appearance. */
function dollarAmounts(price: string): number[] {
  const out: number[] = [];
  for (const m of price.replace(/,/g, "").matchAll(/\$\s*(\d+(?:\.\d+)?)/g)) {
    out.push(Number(m[1]));
  }
  return out;
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** The price clause, or null when we can't state one honestly. */
export function priceClause(e: AnswerEvent): string | null {
  if (e.sold_out) return "Tickets are sold out.";
  if (e.cost_tier === "free") return "Admission is free.";
  if (e.cost_tier === "donation") return "Admission is by donation.";
  if (e.cost_tier === "paid" && e.price) {
    const amounts = dollarAmounts(e.price);
    if (amounts.length === 0) return null;
    const low = Math.min(...amounts);
    const distinct = new Set(amounts).size;
    return distinct === 1 ? `Tickets are ${money(low)}.` : `Tickets from ${money(low)}.`;
  }
  return null;
}

/**
 * The lead passage. Returns null only when even the core sentence can't be
 * built (no usable date), so the page renders nothing rather than a fragment.
 */
export function buildEventAnswer(e: AnswerEvent): string | null {
  const name = e.name.trim().replace(/[.:;,]+$/, "");
  const when = longDate(e.date);
  if (!name || !when) return null;

  const town = e.town.trim();
  const venue = e.venue_name?.trim() ?? "";
  const place = town ? `${town}, ${REGION.stateCode}` : null;
  const showVenue = venue && venue.toLowerCase() !== town.toLowerCase();

  let where = "";
  if (showVenue && place) where = ` at ${venue} in ${place}`;
  else if (showVenue) where = ` at ${venue}`;
  else if (place) where = ` in ${place}`;

  const start = spokenTime(e.start_time);
  const end = spokenTime(e.end_time);
  const clock = start ? (end && end !== start ? ` from ${start} to ${end}` : ` at ${start}`) : "";

  const parts = [`${name} is${where} on ${when}${clock}.`];

  if (e.status === "tentative") parts.push("The date is tentative.");

  const acts = (e.artists ?? []).map((a) => a.trim()).filter(Boolean);
  if (e.category === "live_music" && acts.length > 0 && !nameCarriesActs(name, acts)) {
    const verb = acts.length === 1 ? "is" : "are";
    parts.push(`${listActs(acts)} ${verb} on the bill.`);
  }

  const price = priceClause(e);
  if (price) parts.push(price);

  return parts.join(" ");
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
  checkedAt: string | null | undefined;
  orgName: string | null | undefined;
}): string | null {
  if (opts.verificationStatus !== "verified") return null;
  const when = civilDate(opts.checkedAt);
  if (!when) return null;
  const org = opts.orgName?.trim();
  const whose = org ? `${possessive(org)} site` : "the organizer's site";
  return `Checked against ${whose} on ${when}.`;
}
