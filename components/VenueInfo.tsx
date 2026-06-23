import type { Hwy4Venue } from "@/lib/types";

/**
 * Venue context on the event detail page: a local-voice blurb (sourced from the
 * knowledge base) plus a live-facts strip (rating, hours, phone, website) synced
 * from Google Places. Renders only the fields that are present; renders nothing
 * at all when the venue has no blurb and no facts, so an event at an
 * unrecognized venue shows no empty section.
 *
 * Google attribution: the rating links to the venue's Google Maps page and is
 * labeled "via Google".
 */

function todaysHours(weekdayDescriptions: string[] | null): string | null {
  if (!weekdayDescriptions || weekdayDescriptions.length === 0) return null;
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "America/Los_Angeles",
  }).format(new Date());
  const line = weekdayDescriptions.find((d) =>
    d.toLowerCase().startsWith(today.toLowerCase())
  );
  if (!line) return null;
  // Strip the leading "Monday: " label — the UI labels it "Today" instead.
  const colon = line.indexOf(":");
  return colon === -1 ? line : line.slice(colon + 1).trim();
}

function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

// The handful of practical, decision-driving Google Places attributes worth a
// public badge: the things that change a go/no-go for a parent or a group (Jen:
// "can I bring the dog / the 4-year-old?"; Mia: "is there a patio?"). Curated on
// purpose — we show the few that matter, not every attribute Google returns.
// Tier A (verified, third-party); the rating in the facts strip carries the
// "via Google" attribution for the whole block.
function practicalBadges(attrs: Record<string, unknown> | null): string[] {
  if (!attrs) return [];
  const out: string[] = [];
  if (attrs.allows_dogs === true) out.push("Dog-friendly");
  if (attrs.good_for_children === true) out.push("Kid-friendly");
  if (attrs.outdoor_seating === true) out.push("Patio seating");
  if (attrs.good_for_groups === true) out.push("Good for groups");
  if (Array.isArray(attrs.parking) && attrs.parking.length > 0) out.push("Parking");
  return out;
}

export default function VenueInfo({ venue }: { venue: Hwy4Venue }) {
  const hours = todaysHours(venue.hours);
  const badges = practicalBadges(venue.places_attributes);
  const hasFacts =
    venue.rating != null ||
    hours != null ||
    !!venue.phone ||
    !!venue.website;

  if (!venue.blurb && !hasFacts && badges.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="font-display mb-2 text-lg font-semibold text-forest">
        About {venue.canonical}
      </h2>

      {venue.blurb && (
        <p className="leading-relaxed text-stone">{venue.blurb}</p>
      )}

      {hasFacts && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {venue.rating != null && (
            <a
              href={venue.maps_url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              data-otrack="venue_maps"
              className="inline-flex items-center gap-1 font-medium text-forest hover:underline"
              title="View on Google Maps"
            >
              <span aria-hidden="true" className="text-sunset">
                ★
              </span>
              {venue.rating.toFixed(1)}
              {venue.user_ratings_total != null && (
                <span className="text-stone-light">
                  ({venue.user_ratings_total.toLocaleString()})
                </span>
              )}
              <span className="text-xs text-stone-light">via Google</span>
            </a>
          )}

          {hours && (
            <span className="text-stone">
              <span className="text-stone-light">Today:</span> {hours}
            </span>
          )}

          {venue.phone && (
            <a
              href={`tel:${venue.phone.replace(/[^\d+]/g, "")}`}
              data-otrack="venue_phone"
              className="font-medium text-pine hover:underline"
            >
              {venue.phone}
            </a>
          )}

          {venue.website && (
            <a
              href={venue.website}
              target="_blank"
              rel="noopener noreferrer"
              data-otrack="venue_website"
              className="font-medium text-pine hover:underline"
            >
              {websiteLabel(venue.website)}
            </a>
          )}
        </div>
      )}

      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map((b) => (
            <span
              key={b}
              className="inline-flex items-center rounded-full bg-forest/5 px-2.5 py-0.5 text-xs font-medium text-pine ring-1 ring-inset ring-forest/10"
            >
              {b}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
