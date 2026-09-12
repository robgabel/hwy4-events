"use client";

import { useMemo, useState } from "react";
import { SITE_URL } from "@/lib/constants";
import {
  STAY_MAX_DAYS,
  parseStayRange,
  stayHref,
  stayMaxEnd,
} from "@/lib/stay-range";

// Host-facing builder on /hosts: pick guest dates, copy a stay URL tagged
// src=host so the rental channel is attributable. Dates default to this
// weekend (server-computed, Pacific) so the first click is useful.

function withSrc(path: string, src: string): string {
  const joiner = path.includes("?") ? "&" : "?";
  return `${SITE_URL}${path}${joiner}src=${src}`;
}

export default function StayLinkBuilder({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [copied, setCopied] = useState<"stay" | "weekend" | null>(null);

  const stay = useMemo(() => parseStayRange({ from, to }), [from, to]);
  const stayUrl = stay ? withSrc(stayHref(stay), "host") : null;
  const weekendUrl = withSrc("/this-weekend", "host");
  const maxEnd = from && stayMaxEnd(from);

  function onFromChange(next: string) {
    setFrom(next);
    setCopied(null);
    if (next && to && to < next) setTo(next);
    if (next && to && to > stayMaxEnd(next)) setTo(stayMaxEnd(next));
  }

  async function copy(kind: "stay" | "weekend", url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* textarea below is still selectable */
    }
  }

  const spanHint =
    from && to && !stay
      ? to < from
        ? "Check-out needs to be on or after check-in."
        : `Keep the stay to ${STAY_MAX_DAYS} days or fewer.`
      : null;

  return (
    <div className="rounded-2xl border border-pine/20 bg-pine/5 p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold text-forest">Guests arrive</span>
          <input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            className="mt-1 w-full cursor-pointer rounded-lg border border-stone-light/50 bg-white px-3 py-2 text-sm text-forest focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
          />
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-forest">Guests leave</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={maxEnd || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setCopied(null);
            }}
            className="mt-1 w-full cursor-pointer rounded-lg border border-stone-light/50 bg-white px-3 py-2 text-sm text-forest focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-stone">
        Up to {STAY_MAX_DAYS} days. The page only lists events already on the
        calendar for those dates.
      </p>
      {spanHint && (
        <p className="mt-2 text-sm text-earth" role="status">
          {spanHint}
        </p>
      )}

      <textarea
        readOnly
        value={stayUrl ?? ""}
        rows={2}
        aria-label="Stay link to copy"
        placeholder="Pick both dates to build a stay link."
        className="mt-4 w-full rounded-lg border border-stone-light/40 bg-white p-3 text-sm text-stone-800 focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
        onFocus={(e) => e.currentTarget.select()}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!stayUrl}
          onClick={() => stayUrl && copy("stay", stayUrl)}
          className="inline-flex cursor-pointer items-center rounded-lg bg-sunset px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-earth disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copied === "stay" ? "Copied" : "Copy stay link"}
        </button>
        <button
          type="button"
          onClick={() => copy("weekend", weekendUrl)}
          className="inline-flex cursor-pointer items-center rounded-lg border border-pine/30 bg-white px-4 py-2 text-sm font-medium text-pine transition-colors hover:bg-pine/5"
        >
          {copied === "weekend" ? "Copied" : "Copy this weekend"}
        </button>
      </div>
    </div>
  );
}
