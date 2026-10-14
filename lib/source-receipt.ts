// Where a listing was found, shown on every event page as a Source line.
// Independent of resolveEventLink (the Visit button). Visit answers "where
// should a reader go"; this answers "what did we read." A venue homepage can
// win the button and still hide the dated GoCalaveras or Visit Murphys page
// we actually scraped (#400). This line always names that page.
//
// Priority (first hit wins):
//   1. event_url, when it is an external http(s) URL (aggregator, durable
//      host, or Facebook). Our own site is not a receipt.
//   2. source_url, when it is an external http(s) URL (calendar page or PDF).
//      This beats a stored photo. The label is the source name. Our /submit
//      URL is not a receipt.
//   3. image_url. "submitted flyer" only when the row is community_sourced.
//      A scraped photo with no external source links the image under the
//      source name.
//   4. community text ("Submitted by community") when nothing is linkable.
//
// Always returns a line. A blank beats a guessed URL. Locked by
// scripts/test/source-receipt.test.ts.

import { civilDate } from "./event-answer";
import { aggregatorHostLabel, isUnstableHost } from "./event-link";
import { REGION } from "./region";
import { isHttpUrl } from "./url";

export type SourceReceiptKind =
  | "aggregator"
  | "durable"
  | "facebook"
  | "flyer"
  | "community";

export interface SourceReceiptInput {
  event_url?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  image_url?: string | null;
  community_sourced?: boolean | null;
  last_scraped_at?: string | null;
  org_slug?: string | null;
}

export interface SourceReceipt {
  kind: SourceReceiptKind;
  /** External href, or null for an honest text receipt. */
  href: string | null;
  /** Words after "Source: ". */
  label: string;
  /** Civil date of last_scraped_at in the region timezone, or null. */
  seenOn: string | null;
}

const FLYER_LABEL = "submitted flyer";
const COMMUNITY_LABEL = "Submitted by community";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isOwnSite(url: string): boolean {
  const host = hostOf(url);
  const own = hostOf(REGION.defaultSiteUrl);
  return !!host && !!own && host === own;
}

/** External http(s) URL that is not this site. Junk and our /submit form are absent. */
function externalUrl(raw: string | null | undefined): string | null {
  if (!raw || !isHttpUrl(raw) || isOwnSite(raw)) return null;
  return raw;
}

function isFacebookUrl(url: string): boolean {
  const host = hostOf(url);
  return !!host && (host === "facebook.com" || host.endsWith(".facebook.com"));
}

function listingLabel(ev: SourceReceiptInput, href: string): string {
  const name = ev.source_name?.replace(/\s+/g, " ").trim();
  if (name && /\s/.test(name) && !/community submission/i.test(name)) return name;
  if (ev.org_slug) {
    const fromSlug = REGION.sourceSlugLabels[ev.org_slug];
    if (fromSlug) return fromSlug;
  }
  return aggregatorHostLabel(href);
}

function withSeen(
  ev: SourceReceiptInput,
  partial: Omit<SourceReceipt, "seenOn">
): SourceReceipt {
  return { ...partial, seenOn: civilDate(ev.last_scraped_at) };
}

/**
 * The receipt for one event. Pure. Callers render `Source: {label}` and, when
 * href is set, link the label. seenOn is appended as "(seen {seenOn})".
 */
export function resolveSourceReceipt(ev: SourceReceiptInput): SourceReceipt {
  const eventUrl = externalUrl(ev.event_url);
  if (eventUrl) {
    if (isFacebookUrl(eventUrl)) {
      return withSeen(ev, {
        kind: "facebook",
        href: eventUrl,
        label: REGION.sourceHostLabels["facebook.com"] ?? "Facebook",
      });
    }
    if (isUnstableHost(eventUrl)) {
      return withSeen(ev, {
        kind: "aggregator",
        href: eventUrl,
        label: aggregatorHostLabel(eventUrl),
      });
    }
    return withSeen(ev, {
      kind: "durable",
      href: eventUrl,
      label: aggregatorHostLabel(eventUrl),
    });
  }

  const sourceUrl = externalUrl(ev.source_url);
  if (sourceUrl) {
    return withSeen(ev, {
      kind: "durable",
      href: sourceUrl,
      label: listingLabel(ev, sourceUrl),
    });
  }

  const image = externalUrl(ev.image_url);
  if (image) {
    if (ev.community_sourced) {
      return withSeen(ev, { kind: "flyer", href: image, label: FLYER_LABEL });
    }
    return withSeen(ev, {
      kind: "durable",
      href: image,
      label: listingLabel(ev, image),
    });
  }

  const name = ev.source_name?.replace(/\s+/g, " ").trim();
  if (ev.community_sourced || !name || /community submission/i.test(name)) {
    return withSeen(ev, { kind: "community", href: null, label: COMMUNITY_LABEL });
  }
  return withSeen(ev, { kind: "durable", href: null, label: name });
}

/** Visible sentence, without the link split. The arrow is presentation only. */
export function sourceReceiptSentence(receipt: SourceReceipt): string {
  const seen = receipt.seenOn ? ` (seen ${receipt.seenOn})` : "";
  return `Source: ${receipt.label}${seen}`;
}
