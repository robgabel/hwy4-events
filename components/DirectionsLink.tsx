"use client";

import { useEffect, useState } from "react";
import { buildDirectionsUrl, buildAppleDirectionsUrl } from "@/lib/address";

interface DirectionsLinkProps {
  address: string | null;
  town: string;
  venueName: string;
}

/**
 * "Get Directions" link. Renders the Google Maps URL by default (works on
 * Android, desktop, and as a fallback), then swaps to Apple Maps after mount
 * for iOS/iPadOS users, who expect the link to open the Maps app.
 */
export default function DirectionsLink({ address, town, venueName }: DirectionsLinkProps) {
  const [href, setHref] = useState(() => buildDirectionsUrl(address, town, venueName));

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS reports as Macintosh but has a touch screen
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) setHref(buildAppleDirectionsUrl(address, town, venueName));
  }, [address, town, venueName]);

  return (
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
}
