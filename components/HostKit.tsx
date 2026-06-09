"use client";

import { useState } from "react";

// The interactive half of /hosts: pick a town, preview the printable QR card,
// grab the print/download link, and copy a paste-ready pre-arrival blurb. The
// card image itself is generated server-side by app/hosts/card/route.tsx.

const TOWNS = [
  "Murphys",
  "Arnold",
  "Angels Camp",
  "Copperopolis",
  "Avery",
  "White Pines",
  "Camp Connell",
  "Dorrington",
  "Bear Valley",
];

function blurbFor(town: string): string {
  const place = town === "the corridor" ? "Highway 4" : town;
  return `Before you head up, one local tip: hwy4events.com has everything happening around ${place} this weekend, from live music and festivals to wine events and farmers markets. Give it a look the morning you arrive so you don't miss the good stuff. Enjoy your stay!`;
}

export default function HostKit() {
  const [town, setTown] = useState("Murphys");
  const [copied, setCopied] = useState(false);

  const isCorridor = town === "the corridor";
  const cardSrc = isCorridor ? "/hosts/card" : `/hosts/card?town=${encodeURIComponent(town)}`;
  const blurb = blurbFor(town);

  async function copyBlurb() {
    try {
      await navigator.clipboard.writeText(blurb);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the textarea below is still selectable */
    }
  }

  return (
    <div className="rounded-2xl border border-stone-light/30 bg-cream p-6 sm:p-8">
      {/* town picker */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label htmlFor="host-town" className="text-sm font-semibold text-forest">
          Where&rsquo;s your rental?
        </label>
        <select
          id="host-town"
          value={town}
          onChange={(e) => {
            setTown(e.target.value);
            setCopied(false);
          }}
          className="cursor-pointer rounded-lg border border-stone-light/50 bg-white px-3 py-1.5 text-sm font-medium text-forest focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
        >
          {TOWNS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value="the corridor">Whole corridor</option>
        </select>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        {/* the card */}
        <div>
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-earth">
            1. The counter card
          </h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardSrc}
            alt={`Highway 4 weekend events QR card for ${town}`}
            className="w-full max-w-[300px] rounded-xl border border-stone-light/30 shadow-sm"
            width={1080}
            height={1512}
          />
          <p className="mt-3 text-sm text-stone">
            A 5×7 card for the welcome book or kitchen counter. Guests scan it
            and see what&rsquo;s on this weekend. No app, no sign-up.
          </p>
          <a
            href={cardSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block cursor-pointer rounded-lg bg-pine px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-forest"
          >
            Open to print or save →
          </a>
        </div>

        {/* the blurb */}
        <div>
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-earth">
            2. The pre-arrival note
          </h3>
          <p className="mb-3 text-sm text-stone">
            Paste this into your check-in message so guests have it before they
            even pack the car.
          </p>
          <textarea
            readOnly
            value={blurb}
            rows={6}
            className="w-full rounded-lg border border-stone-light/40 bg-white p-3 text-sm text-stone-800 focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={copyBlurb}
            className="mt-3 inline-block cursor-pointer rounded-lg bg-sunset px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-earth"
          >
            {copied ? "Copied ✓" : "Copy the note"}
          </button>
        </div>
      </div>
    </div>
  );
}
