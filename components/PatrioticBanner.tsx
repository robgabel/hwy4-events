import type { CSSProperties } from "react";

// Old Glory palette — shared with the parade card/detail so the patriotic
// treatment reads consistently without leaking flag colors into the site tokens.
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
 * Red/white/blue masthead for a Fourth-of-July feature event's OWN detail page
 * (e.g. the Sierra Nevada Arts & Crafts Festival). Sets the patriotic tone above
 * the event's real poster/description/map, mirroring the parade hero's language
 * without duplicating the title or pulling in parade-specific content.
 */
export default function PatrioticBanner({ town }: { town: string }) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-2xl px-5 py-4 text-white shadow-lg sm:px-6 sm:py-5"
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
      <div className="pointer-events-none absolute -right-3 -top-2 flex gap-1.5 text-white/10">
        <Star className="h-20 w-20" />
        <Star className="mt-6 h-12 w-12" />
      </div>

      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: RED }}
        >
          <Star className="h-3.5 w-3.5" />
          Independence Day
        </span>
        <span className="font-display text-lg font-bold sm:text-xl">
          Fourth of July in {town}
        </span>
      </div>
    </div>
  );
}
