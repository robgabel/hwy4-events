// Classic-rock palette — shared in spirit with ClassicRockEventCard so the
// treatment reads consistently without leaking into the site tokens.
const GRAD = "linear-gradient(135deg, #2A1733 0%, #3A1230 52%, #531427 100%)";
const AMBER = "#F2B544";
const HOT = "#E5484D";

function Vinyl({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <circle cx="12" cy="12" r="8" stroke="#000" strokeOpacity="0.25" strokeWidth="0.6" />
      <circle cx="12" cy="12" r="6" stroke="#000" strokeOpacity="0.25" strokeWidth="0.6" />
      <circle cx="12" cy="12" r="3.4" fill="#E5484D" />
      <circle cx="12" cy="12" r="0.9" fill="#000" fillOpacity="0.5" />
    </svg>
  );
}

/**
 * Stage-light masthead for the Flashback concert's OWN detail page. Sets a
 * classic-rock tone above the event's real poster/description/map, mirroring how
 * PatrioticBanner / AdoptAPetBanner dress a feature event without duplicating
 * content. Selected via isClassicRockEvent() on the detail page.
 */
export default function ClassicRockBanner({ town }: { town: string }) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-2xl px-5 py-5 text-white shadow-lg sm:px-7 sm:py-6"
      style={{ background: GRAD }}
    >
      {/* Big ghost record off the corner */}
      <div className="pointer-events-none absolute -right-8 -top-8 text-white/10" aria-hidden="true">
        <Vinyl className="h-40 w-40" />
      </div>
      {/* Equalizer bars */}
      <div className="pointer-events-none absolute right-6 top-6 hidden items-end gap-1.5 opacity-50 sm:flex" aria-hidden="true">
        <span className="block w-1.5 rounded-full" style={{ height: 16, backgroundColor: AMBER }} />
        <span className="block w-1.5 rounded-full" style={{ height: 30, backgroundColor: HOT }} />
        <span className="block w-1.5 rounded-full" style={{ height: 12, backgroundColor: AMBER }} />
        <span className="block w-1.5 rounded-full" style={{ height: 24, backgroundColor: HOT }} />
        <span className="block w-1.5 rounded-full" style={{ height: 18, backgroundColor: AMBER }} />
      </div>

      <div className="relative max-w-[34rem] sm:pr-28">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
          style={{ backgroundColor: AMBER, color: "#2A1733" }}
        >
          <Vinyl className="h-3.5 w-3.5 text-white" />
          Classic Rock Night
        </span>

        <h2 className="mt-2.5 font-display text-xl font-bold leading-tight sm:text-2xl">
          Turn it up in {town}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-white/90">
          Flashback plays classic rock covers up at the Moose Lodge. Dinner and a
          full bar, the dance floor opens up after the first set, and you don&apos;t
          need to be a member to come in.
        </p>
      </div>
    </div>
  );
}
