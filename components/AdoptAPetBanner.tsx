import type { CSSProperties } from "react";
import Image from "next/image";

// Warm "Adopt-a-Pet Day" palette — shared in spirit with AdoptAPetEventCard so
// the pet-day treatment reads consistently without leaking into the site tokens.
const GRAD = "linear-gradient(135deg, #C25733 0%, #A8442A 55%, #8F3A26 100%)";
const DEEP = "#7A3320"; // deep cocoa-coral — the anchor pill

function Paw({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <ellipse cx="12" cy="15.5" rx="5" ry="4.5" />
      <ellipse cx="6.5" cy="9" rx="2.2" ry="2.8" transform="rotate(-15 6.5 9)" />
      <ellipse cx="10" cy="6.5" rx="2" ry="2.8" transform="rotate(-5 10 6.5)" />
      <ellipse cx="14" cy="6.5" rx="2" ry="2.8" transform="rotate(5 14 6.5)" />
      <ellipse cx="17.5" cy="9" rx="2.2" ry="2.8" transform="rotate(15 17.5 9)" />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

// Every adoption comes with these, fee or no fee — straight from the shelter.
const PERKS = ["Fee waived", "Spayed & neutered", "Vaccinated", "Microchipped", "Starter food"];

/**
 * Warm, pet-celebrating masthead for Adopt-a-Pet Day's OWN detail page. Sets the
 * joyful tone above the event's real poster/description/map, mirroring how
 * PatrioticBanner dresses a Fourth-of-July feature without duplicating content.
 * Millie peeks in from a cream porthole — the same mascot beat as the email hero.
 */
export default function AdoptAPetBanner({ town }: { town: string }) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-2xl px-5 py-5 text-white shadow-lg sm:px-7 sm:py-6"
      style={{ background: GRAD }}
    >
      {/* Paw-print field, top-right */}
      <div className="pointer-events-none absolute -right-4 -top-3 text-white/10" aria-hidden="true">
        <Paw className="h-24 w-24" />
      </div>
      <div className="pointer-events-none absolute right-20 top-8 text-white/[0.08]" aria-hidden="true">
        <Paw className="h-12 w-12 -rotate-12" />
      </div>

      {/* Millie peeking from a cream porthole (hidden on the narrowest screens) */}
      <div className="pointer-events-none absolute -bottom-4 right-4 hidden sm:block" aria-hidden="true">
        <div className="flex h-28 w-28 items-end justify-center overflow-hidden rounded-full bg-cream shadow-md ring-4 ring-white/30">
          <Image
            src="/millie-happy.svg"
            alt=""
            width={112}
            height={126}
            className="translate-y-2"
          />
        </div>
      </div>

      <div className="relative max-w-[34rem] sm:pr-28">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: DEEP }}
        >
          <Paw className="h-3.5 w-3.5" />
          Adopt-a-Pet Day
        </span>

        <h2 className="mt-2.5 font-display text-xl font-bold leading-tight sm:text-2xl">
          Fee-waived adoptions in {town}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-white/90">
          Every animal at the shelter goes home free this Saturday: a dozen-plus
          kittens and a couple of good dogs, all looking for a home.
        </p>

        {/* What every adoption still includes — celebration that also informs */}
        <ul className="mt-3.5 flex flex-wrap gap-1.5">
          {PERKS.map((perk) => (
            <li
              key={perk}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white"
            >
              <Check className="h-3 w-3 text-white/90" />
              {perk}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
