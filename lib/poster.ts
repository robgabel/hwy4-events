import type { Hwy4Event } from "./types";
import { SITE_URL } from "./constants";

export type PosterKind = "supplied" | "generated";

/**
 * The branding rule (PRD-event-poster-loop §9): we only stamp posters we make.
 *
 * - **supplied** — the organizer gave us their own artwork (`image_url`). We
 *   show it *untouched*: no QR, mascot, or "Poster by" overlaid. Sharing and
 *   attribution run through the page UI, never by defacing their work.
 * - **generated** — no source image, so we render the branded Hwy4Events
 *   screenprint from the event data (via the poster route below).
 */
export function posterKind(event: Pick<Hwy4Event, "image_url">): PosterKind {
  return event.image_url ? "supplied" : "generated";
}

/** Relative path to the generated-poster render route for an event. */
export function generatedPosterPath(slug: string): string {
  return `/events/${slug}/poster`;
}

/**
 * The poster image to display / share / download for an event. Supplied
 * posters use the organizer's image as-is; generated posters point at the
 * render route. Returns an absolute URL (for OG metadata + sharing).
 */
export function posterImageUrl(
  event: Pick<Hwy4Event, "image_url">,
  slug: string
): string {
  return posterKind(event) === "supplied"
    ? (event.image_url as string)
    : `${SITE_URL}${generatedPosterPath(slug)}`;
}

/** Append a source-channel param for share attribution (?src=share|qr|pdf…). */
export function withSrc(url: string, src: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("src", src);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}src=${encodeURIComponent(src)}`;
  }
}
