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
        <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Hwy 4 Events
        </h1>

        <p className="mt-3 font-display text-lg text-sage-light/90">
          From the Frog Jump to the summit
        </p>
        <p className="mt-1 text-sm text-sage-light/60">
          Angels Camp &middot; Murphys &middot; Arnold &middot; Bear Valley
        </p>

        {/* Seasonal greeting from Rob */}
        {greeting && (
          <p className="mx-auto mt-4 max-w-md rounded-lg bg-white/10 px-4 py-2 text-sm italic text-sage-light/80 backdrop-blur-sm">
            {greeting}
          </p>
        )}
      </div>
    </header>
  );
}
