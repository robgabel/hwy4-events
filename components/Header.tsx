export default function Header() {
  return (
    <header className="hero-gradient mountain-bg tree-line relative">
      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-28 pt-12 text-center">
        <div className="mb-1 flex items-center justify-center gap-4">
          <svg
            className="h-8 w-8 text-sage-light opacity-80"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L6 10h3l-4 8h5v4h4v-4h5l-4-8h3L12 2z" />
          </svg>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Hwy 4 Events
          </h1>
          <svg
            className="h-8 w-8 text-sage-light opacity-80"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L6 10h3l-4 8h5v4h4v-4h5l-4-8h3L12 2z" />
          </svg>
        </div>

        <p className="mt-3 text-lg text-sage-light/90">
          Angels Camp &middot; Murphys &middot; Arnold &middot; Bear Valley
          <br />
          <span className="text-base text-sage-light/70">
            and everywhere in between
          </span>
        </p>

        {/* Mountain range silhouette */}
        <div className="mt-6 flex justify-center">
          <svg
            viewBox="0 0 800 120"
            className="h-20 w-full max-w-2xl text-white"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Far range - tallest peaks */}
            <path
              d="M0,120 L20,85 L55,95 L90,55 L130,80 L165,40 L200,70 L240,25 L280,60 L320,35 L360,15 L400,45 L440,30 L480,55 L520,20 L560,50 L600,35 L640,60 L680,45 L720,65 L760,55 L800,70 L800,120 Z"
              opacity="0.12"
            />
            {/* Mid range */}
            <path
              d="M0,120 L30,80 L65,90 L100,60 L140,85 L175,50 L210,75 L250,40 L290,65 L330,45 L370,70 L410,55 L450,75 L490,45 L530,65 L570,50 L610,70 L650,55 L690,75 L730,60 L770,75 L800,65 L800,120 Z"
              opacity="0.18"
            />
            {/* Near range - foothills */}
            <path
              d="M0,120 L40,90 L80,100 L120,80 L160,95 L200,75 L240,90 L280,70 L320,85 L360,75 L400,88 L440,78 L480,90 L520,80 L560,92 L600,82 L640,95 L680,85 L720,95 L760,88 L800,95 L800,120 Z"
              opacity="0.1"
            />
            {/* Pine trees scattered on ridgeline */}
            <g opacity="0.15">
              <path d="M95,60 L100,40 L105,60 Z" />
              <path d="M110,62 L114,48 L118,62 Z" />
              <path d="M240,28 L245,10 L250,28 Z" />
              <path d="M258,30 L262,18 L266,30 Z" />
              <path d="M360,18 L366,0 L372,18 Z" />
              <path d="M380,22 L384,10 L388,22 Z" />
              <path d="M520,24 L525,8 L530,24 Z" />
              <path d="M540,28 L544,14 L548,28 Z" />
              <path d="M640,58 L644,44 L648,58 Z" />
              <path d="M170,52 L174,38 L178,52 Z" />
              <path d="M450,56 L454,42 L458,56 Z" />
              <path d="M690,74 L694,60 L698,74 Z" />
            </g>
          </svg>
        </div>
      </div>
    </header>
  );
}
