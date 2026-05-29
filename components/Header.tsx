import Image from "next/image";
import Link from "next/link";
import { CORRIDOR_TOWNS } from "@/lib/towns";
import { townSlug } from "@/lib/slugs";

/** A Calaveras Big Trees sequoia — layered crown over a tall trunk. */
function BigTree({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 40"
      fill="currentColor"
      className={className}
    >
      <path d="M12 33h4v7h-4z" />
      <path d="M14 12 3 34h22z" />
      <path d="M14 7 6 24h16z" />
      <path d="M14 3 9 16h10z" />
    </svg>
  );
}

export default function Header({ greeting }: { greeting?: string | null }) {
  return (
    <header className="hero-photo relative">
      {/* Solid gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-forest via-forest to-forest/90" />

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-20 pt-10 text-center sm:pb-24 sm:pt-12">
        <h1 className="inline-flex items-center justify-center gap-3 font-display text-4xl font-bold tracking-tight text-white sm:gap-4 sm:text-5xl">
          <BigTree className="h-10 w-7 shrink-0 text-sage-light/60 sm:h-12 sm:w-9" />
          Hwy 4 Events
          <BigTree className="h-10 w-7 shrink-0 text-sage-light/60 sm:h-12 sm:w-9" />
        </h1>

        <p className="mt-3 font-display text-lg text-white/90 drop-shadow-sm">
          From the Frog Jump to the Grizzly Chair
        </p>

        {/* All nine towns, honestly — quiet and secondary */}
        <div className="mx-auto mt-4 flex max-w-xl flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs font-medium tracking-wide text-white/55">
          {CORRIDOR_TOWNS.map((town, i) => (
            <span key={town.name} className="inline-flex items-center gap-x-1.5">
              {i > 0 && <span aria-hidden="true">&middot;</span>}
              <Link
                href={`/towns/${townSlug(town.name)}`}
                className="whitespace-nowrap transition-colors hover:text-white hover:underline"
              >
                {town.name}
              </Link>
            </span>
          ))}
        </div>

        {/* Seasonal greeting from Rob */}
        {greeting && (
          <p className="mx-auto mt-4 max-w-md rounded-lg bg-white/10 px-4 py-2 text-sm italic text-sage-light/80 backdrop-blur-sm">
            {greeting}
          </p>
        )}
      </div>

      {/* Millie peeking over the wave divider */}
      <div className="absolute bottom-0 left-1/2 z-20 -translate-x-1/2 translate-y-[35%]">
        <Image
          src="/millie-happy.svg"
          alt="Millie the sheepadoodle"
          width={80}
          height={80}
          className="opacity-95 drop-shadow-sm sm:h-[88px] sm:w-[88px]"
        />
      </div>
    </header>
  );
}
