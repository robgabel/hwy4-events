"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
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
  /** Clean address string the interactive map geocodes (on tap) to pin the venue. */
  geocodeQuery: string | null;
  /** Map center — geocoded venue coords, or the town centroid as a fallback. */
  mapLat: number | null;
  mapLng: number | null;
  mapZoom: number;
}

export default function EventMapStatic({
  town,
  venueName,
  address,
  geocodeQuery,
  mapLat,
  mapLng,
  mapZoom,
}: EventMapStaticProps) {
  const [interactive, setInteractive] = useState(false);

  // No coordinates at all (unknown town): show directions only.
  if (mapLat == null || mapLng == null) {
    return (
      <section className="mb-6">
        <DirectionsLink address={address} town={town} venueName={venueName} />
      </section>
    );
  }

  if (interactive) {
    // EventMap renders its own framed map + Get Directions link.
    return (
      <EventMap
        town={town}
        venueName={venueName}
        address={address}
        geocodeQuery={geocodeQuery}
        mapLat={mapLat}
        mapLng={mapLng}
        mapZoom={mapZoom}
      />
    );
  }

  const staticSrc = `/api/static-map?lat=${mapLat}&lng=${mapLng}&z=${mapZoom}`;

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={() => setInteractive(true)}
        aria-label={`Show interactive map of ${venueName}`}
        className="group relative block w-full cursor-pointer overflow-hidden rounded-lg border border-stone-light/30 card-warm"
      >
        <img
          src={staticSrc}
          alt={`Map showing ${venueName} in ${town}, California`}
          width={1200}
          height={600}
          className="h-[240px] sm:h-[300px] w-full object-cover"
        />
        {/* Brand pin, tip anchored at image center (= the geocoded venue) */}
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
