export default function Header() {
  return (
    <header className="hero-gradient mountain-bg tree-line relative">
      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-28 pt-12 text-center">
        {/* Pine tree icon */}
        <div className="mb-4 flex items-center justify-center gap-3">
          <svg
            className="h-8 w-8 text-sage-light opacity-80"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L6 10h3l-4 8h5v4h4v-4h5l-4-8h3L12 2z" />
          </svg>
          <span className="text-sm font-medium uppercase tracking-[0.3em] text-sage-light/80">
            Highway 4 Corridor
          </span>
          <svg
            className="h-8 w-8 text-sage-light opacity-80"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L6 10h3l-4 8h5v4h4v-4h5l-4-8h3L12 2z" />
          </svg>
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Hwy 4 Events
        </h1>

        <p className="mt-3 text-lg text-sage-light/90">
          Angels Camp &middot; Murphys &middot; Arnold &middot; Bear Valley
          <br />
          <span className="text-base text-sage-light/70">
            and everywhere in between
          </span>
        </p>

        {/* Mountain range illustration */}
        <div className="mt-6 flex items-end justify-center gap-1 opacity-30">
          <div className="h-6 w-3 rounded-t bg-white/40" />
          <div className="h-10 w-4 rounded-t bg-white/30" />
          <div className="h-16 w-5 rounded-t bg-white/20" />
          <div className="h-12 w-4 rounded-t bg-white/25" />
          <div className="h-20 w-6 rounded-t bg-white/15" />
          <div className="h-14 w-5 rounded-t bg-white/20" />
          <div className="h-8 w-3 rounded-t bg-white/30" />
          <div className="h-18 w-5 rounded-t bg-white/20" />
          <div className="h-10 w-4 rounded-t bg-white/25" />
          <div className="h-6 w-3 rounded-t bg-white/35" />
        </div>
      </div>
    </header>
  );
}
