"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { TOWN_INFO } from "@/lib/towns";
import { townSlug } from "@/lib/slugs";
import { buildDirectionsUrl } from "@/lib/address";

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
}

const DirectionsLink = ({ href }: { href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-pine hover:underline"
  >
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
    Get Directions
  </a>
);

export default function EventMapStatic({ town, venueName, address }: EventMapStaticProps) {
  const [interactive, setInteractive] = useState(false);
  const townData = TOWN_INFO[town];
  const directionsUrl = buildDirectionsUrl(address, town, venueName);

  // Unknown town: no coordinates, no static image — show directions only.
  if (!townData?.lat || !townData?.lng) {
    return (
      <section className="mb-6">
        <DirectionsLink href={directionsUrl} />
      </section>
    );
  }

  if (interactive) {
    // EventMap renders its own framed map + Get Directions link.
    return <EventMap town={town} venueName={venueName} address={address} />;
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
      <DirectionsLink href={directionsUrl} />
    </section>
  );
}
