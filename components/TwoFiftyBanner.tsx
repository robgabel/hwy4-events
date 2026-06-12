import type { CSSProperties } from "react";

// Old Glory palette — shared with PatrioticBanner / the parade card so the
// patriotic treatment reads consistently without leaking flag colors into the
// site's earthy token set.
const NAVY = "#3C3B6E"; // Old Glory Blue
const RED = "#B22234"; // Old Glory Red

function Star({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <path d="M12 2l2.95 6.18 6.8.78-5.04 4.6 1.36 6.7L12 17.6 5.93 20.86l1.36-6.7L2.25 9.56l6.8-.78L12 2z" />
    </svg>
  );
}

/**
 * Red/white/blue masthead for an America's-250th feature that is NOT on the
 * Fourth of July (the Hot Copper Car Show, Jun 20). Same Old Glory anatomy as
 * PatrioticBanner — stripe band, faint star field — but tagged "America's 250th"
 * and headlined "Red, White & Chrome", so it sets a patriotic, car-show tone
 * above the event's real poster/description/map without claiming the Fourth.
 * Selected via isTwoFiftyEvent() on the detail page.
 */
export default function TwoFiftyBanner({ town }: { town: string }) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-2xl px-5 py-5 text-white shadow-lg sm:px-7 sm:py-6"
      style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #2b2a52 55%, #232248 100%)`,
      }}
    >
      {/* Stripe band across the very top */}
      <div
        className="absolute inset-x-0 top-0 h-1.5"
        style={{
          background:
            "repeating-linear-gradient(90deg, #B22234 0 18px, #FFFFFF 18px 36px)",
        }}
      />
      {/* Faint star field, top-right */}
      <div className="pointer-events-none absolute -right-3 -top-2 flex gap-1.5 text-white/10" aria-hidden="true">
        <Star className="h-24 w-24" />
        <Star className="mt-7 h-14 w-14" />
      </div>

      <div className="relative max-w-[36rem] sm:pr-24">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: RED }}
        >
          <Star className="h-3.5 w-3.5" />
          America&apos;s 250th
        </span>

        <h2 className="mt-2.5 font-display text-xl font-bold leading-tight sm:text-2xl">
          Red, White &amp; Chrome
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-white/90">
          Twenty-five years running, the Lake Tulloch Lions Club fills the {town}{" "}
          town square with classic cars, trucks, and motorcycles, and this year it
          kicks off the summer of America&apos;s 250th. Worth the trek down the
          hill: a raffle, live music, vendors, and real food, with every dollar
          going to Lions scholarships and local projects. Rain or shine, 8 to 3.
        </p>
      </div>
    </div>
  );
}
