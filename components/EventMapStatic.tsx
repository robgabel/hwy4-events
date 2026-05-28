"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { TOWN_INFO } from "@/lib/towns";
import { townSlug } from "@/lib/slugs";
import DirectionsLink from "./DirectionsLink";

const EventMap = dynamic(() => import("./EventMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] sm:h-[300px] w-full animate-pulse bg-warm-white" />
  ),
});

interface EventMapStaticProps {
  town: string;
  venueName: string;
  address: string | null;
  /** Geocoded venue coordinates; the interactive map centers/pins here. */
  lat?: number | null;
  lng?: number | null;
}

export default function EventMapStatic({ town, venueName, address, lat, lng }: EventMapStaticProps) {
  const [interactive, setInteractive] = useState(false);
  const townData = TOWN_INFO[town];

  // Unknown town: no coordinates, no static image — show directions only.
  if (!townData?.lat || !townData?.lng) {
    return (
      <section className="mb-6">
        <DirectionsLink address={address} town={town} venueName={venueName} />
      </section>
    );
  }

  if (interactive) {
    // EventMap renders its own framed map + Get Directions link.
    return <EventMap town={town} venueName={venueName} address={address} lat={lat} lng={lng} />;
  }

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={() => setInteractive(true)}
        aria-label={`Show interactive map of ${town}`}
        className="group relative block w-full cursor-pointer overflow-hidden rounded-lg border border-stone-light/30 card-warm"
      >
        <img
          src={`/maps/${townSlug(town)}.webp`}
          alt={`Map of ${town}, California`}
          width={1200}
          height={600}
          className="h-[240px] sm:h-[300px] w-full object-cover"
        />
        {/* Brand pin, tip anchored at image center */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
          <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="#1B3A2D" />
            <circle cx="16" cy="15" r="6" fill="#FDF8F3" />
          </svg>
        </span>
        <span className="absolute bottom-2 right-2 rounded-full bg-warm-white/90 px-2.5 py-1 text-xs font-medium text-forest shadow-sm transition group-hover:bg-warm-white">
          Tap for interactive map
        </span>
      </button>
      <DirectionsLink address={address} town={town} venueName={venueName} />
    </section>
  );
}
