import Image from "next/image";

export default function Header({ greeting }: { greeting?: string | null }) {
  return (
    <header className="hero-photo relative">
      {/* Photo background */}
      <div className="absolute inset-0">
        <Image
          src="/images/bear_valley.jpg"
          alt="Highway 4 corridor through the Sierra Nevada pines"
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
        {/* Dark overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-forest/70 via-forest/50 to-forest/80" />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-20 pt-10 text-center sm:pb-24 sm:pt-12">
        <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl inline-flex items-center justify-center gap-3">
          <svg aria-hidden="true" className="h-8 w-8 sm:h-10 sm:w-10 text-sage-light/80" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L8 8h2L6 14h2.5L5 20h14l-3.5-6H18l-4-6h2L12 2z"/></svg>
          Hwy 4 Events
          <svg aria-hidden="true" className="h-8 w-8 sm:h-10 sm:w-10 text-sage-light/80" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L8 8h2L6 14h2.5L5 20h14l-3.5-6H18l-4-6h2L12 2z"/></svg>
        </h1>

        <p className="mt-3 font-display text-lg text-white/90 drop-shadow-sm">
          From the Frog Jump to the Grizzly Chair
        </p>
        <p className="mt-1 text-sm font-medium text-white/70 tracking-wide">
          Angels Camp &middot; Murphys &middot; Arnold &middot; Bear Valley
        </p>

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
          width={64}
          height={64}
          className="opacity-90 drop-shadow-sm sm:h-[72px] sm:w-[72px]"
        />
      </div>
    </header>
  );
}
