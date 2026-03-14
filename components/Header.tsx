import Image from "next/image";

export default function Header({ greeting }: { greeting?: string | null }) {
  return (
    <header className="hero-gradient mountain-bg relative">
      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-24 pt-10 text-center">
        {/* Title with Millie */}
        <div className="mb-1 flex items-center justify-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Hwy 4 Events
          </h1>
          <Image
            src="/millie-lying-white.svg"
            alt="Millie the sheepadoodle"
            width={90}
            height={54}
            className="hidden opacity-80 sm:block"
            priority
          />
        </div>

        <p className="mt-3 text-lg text-sage-light/90">
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
