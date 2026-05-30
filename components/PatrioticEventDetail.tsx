import type { CSSProperties } from "react";
import type { Hwy4Event } from "@/lib/types";
import { SITE_URL } from "@/lib/constants";
import { TOWN_INFO } from "@/lib/towns";
import Link from "next/link";
import EventMap from "@/components/EventMapStatic";
import ShareButton from "@/components/ShareButton";

const NAVY = "#3C3B6E"; // Old Glory Blue
const RED = "#B22234"; // Old Glory Red

function Star({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <path d="M12 2l2.95 6.18 6.8.78-5.04 4.6 1.36 6.7L12 17.6 5.93 20.86l1.36-6.7L2.25 9.56l6.8-.78L12 2z" />
    </svg>
  );
}

// Logistics straight off the official parade flyer. Stable annual facts, so they
// live in code rather than the free-text description (which stays spectator-facing).
const PARTICIPANT_RULES: { title: string; body: string }[] = [
  {
    title: "Be in staging by 9:15 AM",
    body: "Enter at the upper Byway entrance. Highway 4 closes to cars at 9:30 AM sharp.",
  },
  {
    title: "One entry per sign-up",
    body: "Don't show up with an extra float or something added on. The line-up is set ahead of time.",
  },
  {
    title: "Horses are welcome",
    body: "We love the horses. Just bring a pooper-scooper and a scoopee. Staging and Cedar Center would rather skip the road apples.",
  },
  {
    title: "Helmets on wheels",
    body: "Anyone riding bikes, quads, or motorcycles must wear a helmet. It's state law.",
  },
  {
    title: "Keep it celebratory",
    body: "Not a political arena: no protest signs or demonstrations. Organizers may cover up objectionable material.",
  },
  {
    title: "Stay in your slot",
    body: "Once the parade begins, hold your place in line all the way to Cedar Center.",
  },
];

export default function PatrioticEventDetail({
  event,
  slug,
  dateStr,
  timeRange,
  displayAddress,
  geocodeQuery,
  mapLat,
  mapLng,
  mapZoom,
  linkHref,
}: {
  event: Hwy4Event;
  slug: string;
  dateStr: string;
  timeRange: string | null;
  displayAddress: string | null;
  geocodeQuery: string | null;
  mapLat: number | null;
  mapLng: number | null;
  mapZoom: number;
  /** Resolved outbound link (organizer canonical); falls back to arnoldparade.org. */
  linkHref: string | null;
}) {
  const townInfo = TOWN_INFO[event.town];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-stone">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/" className="text-pine hover:underline">
              Hwy 4 Events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="truncate text-stone-light">{event.name}</li>
        </ol>
      </nav>

      {/* Hero banner */}
      <header
        className="relative overflow-hidden rounded-2xl p-6 text-white shadow-xl sm:p-8"
        style={{
          background: `linear-gradient(135deg, ${NAVY} 0%, #2b2a52 55%, #232248 100%)`,
        }}
      >
        {/* Stripe band */}
        <div
          className="absolute inset-x-0 top-0 h-2"
          style={{
            background:
              "repeating-linear-gradient(90deg, #B22234 0 22px, #FFFFFF 22px 44px)",
          }}
        />
        {/* Star field */}
        <div className="pointer-events-none absolute -right-4 -top-2 flex gap-2 text-white/10">
          <Star className="h-28 w-28" />
          <Star className="mt-8 h-16 w-16" />
          <Star className="mt-2 h-10 w-10" />
        </div>

        <div className="relative">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-white"
              style={{ backgroundColor: RED }}
            >
              <Star className="h-3.5 w-3.5" />
              Independence Day
            </span>
            {event.robs_pick && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                Rob&apos;s Pick
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-3xl font-extrabold leading-tight text-white sm:text-4xl">
              {event.name}
            </h1>
            <div className="shrink-0 pt-1">
              <ShareButton
                url={`${SITE_URL}/events/${slug}`}
                title={event.name}
                text={`${event.name} in ${event.town}`}
              />
            </div>
          </div>

          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-white/75">
            Theme: Stars, Stripes &amp; 250 Years
          </p>

          {/* Quick facts */}
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/15">
              {dateStr}
            </span>
            {timeRange && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/15">
                Steps off {timeRange}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white ring-1 ring-white/15">
              1-mile route, all downhill
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold text-white"
              style={{ backgroundColor: RED }}
            >
              Free to watch
            </span>
          </div>
        </div>
      </header>

      {/* Where to watch */}
      {event.description && (
        <section className="mt-7">
          <h2 className="font-display mb-2 flex items-center gap-2 text-lg font-bold" style={{ color: NAVY }}>
            <span className="inline-block h-4 w-1 rounded" style={{ backgroundColor: RED }} />
            Where to watch
          </h2>
          <p className="leading-relaxed text-stone">{event.description}</p>
        </section>
      )}

      {/* The route */}
      <section className="mt-7">
        <h2 className="font-display mb-3 flex items-center gap-2 text-lg font-bold" style={{ color: NAVY }}>
          <span className="inline-block h-4 w-1 rounded" style={{ backgroundColor: RED }} />
          The route
        </h2>
        <div className="rounded-xl border border-stone-light/40 bg-white p-4">
          <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
            {["Lower Arnold Byway (start)", "Down through town", "Cedar Center (finish)"].map(
              (step, i, arr) => (
                <li key={step} className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: i === 0 || i === arr.length - 1 ? RED : NAVY }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium text-forest">{step}</span>
                  {i < arr.length - 1 && (
                    <svg className="hidden h-4 w-4 text-stone-light sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </li>
              )
            )}
          </ol>
          <p className="mt-3 text-sm text-stone">
            Get there early: Highway 4 closes to cars at <strong className="text-forest">9:30 AM sharp</strong>. Park, then stake out a curb.
          </p>
        </div>
      </section>

      {/* Map */}
      <section className="mt-7">
        <EventMap
          town={event.town}
          venueName={event.venue_name}
          address={event.address}
          geocodeQuery={geocodeQuery}
          mapLat={mapLat}
          mapLng={mapLng}
          mapZoom={mapZoom}
        />
        {(displayAddress || townInfo) && (
          <p className="mt-2 text-xs text-stone">
            {event.town}, California
            {townInfo && <> · {townInfo.elevation.toLocaleString()} ft</>}
          </p>
        )}
      </section>

      {/* Marching in the parade? */}
      <section className="mt-8">
        <div className="overflow-hidden rounded-2xl border border-stone-light/40 bg-white">
          <div
            className="px-5 py-3"
            style={{ background: `linear-gradient(135deg, ${NAVY}, #2b2a52)` }}
          >
            <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
              <Star className="h-4 w-4" style={{ color: "#fff" }} />
              Marching in the parade?
            </h2>
            <p className="mt-0.5 text-sm text-white/70">
              Straight from the organizers. Read before you line up.
            </p>
          </div>
          <ul className="divide-y divide-stone-light/30">
            {PARTICIPANT_RULES.map((rule) => (
              <li key={rule.title} className="flex gap-3 px-5 py-3">
                <span
                  className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${RED}1A` }}
                >
                  <Star className="h-3 w-3" style={{ color: RED }} />
                </span>
                <div>
                  <p className="font-semibold text-forest">{rule.title}</p>
                  <p className="text-sm text-stone">{rule.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p
            className="px-5 py-3 text-sm font-medium"
            style={{ backgroundColor: `${RED}0D`, color: NAVY }}
          >
            Free drinks for parade participants at Cedar Center once you finish the route.
          </p>
        </div>
      </section>

      {/* Contact + links */}
      <section className="mt-7">
        <h2 className="font-display mb-3 flex items-center gap-2 text-lg font-bold" style={{ color: NAVY }}>
          <span className="inline-block h-4 w-1 rounded" style={{ backgroundColor: RED }} />
          Sign up &amp; questions
        </h2>
        <div className="rounded-xl border border-stone-light/40 bg-white p-4 text-sm text-stone">
          <p>
            Contact <strong className="text-forest">Linda Baker</strong> at{" "}
            <a href="tel:+12097955600" className="font-medium text-pine underline underline-offset-2 hover:text-forest">
              209-795-5600
            </a>{" "}
            or{" "}
            <a href="mailto:lindabaker@arnoldparade.org" className="font-medium text-pine underline underline-offset-2 hover:text-forest">
              lindabaker@arnoldparade.org
            </a>
            .
          </p>
          <div className="mt-3">
            <a
              href={linkHref ?? "https://www.arnoldparade.org"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: NAVY }}
            >
              Visit arnoldparade.org
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      <div className="mt-8 border-t border-stone-light/30 pt-6">
        <Link href="/" className="text-sm font-medium text-pine hover:underline">
          &larr; Back to all events
        </Link>
      </div>
    </main>
  );
}
