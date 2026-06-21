"use client";

import { useState } from "react";
import ReportEventForm from "./ReportEventForm";

/**
 * "Suggest a fix" that expands the correction form IN PLACE on the event detail
 * page, so the reader keeps the event they think is wrong on screen while they
 * type (no navigating off to a separate page and back).
 *
 * The toggle is a real <a href="/events/<slug>/report">: with JS off it still
 * works (falls back to the standalone report page), and OutboundTracker's
 * document-level `a[data-otrack]` listener still records the click. With JS on,
 * onClick prevents the navigation and opens the form below instead.
 */
export default function SuggestFixInline({
  slug,
  eventName,
}: {
  slug: string;
  eventName: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <p className="mt-4 text-sm text-stone">
        See something off?{" "}
        <a
          href={`/events/${slug}/report`}
          data-otrack="suggest_fix"
          aria-expanded={false}
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          className="cursor-pointer font-medium text-pine underline underline-offset-2 hover:text-forest"
        >
          Suggest a fix
        </a>
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-stone-light/30 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-forest">Suggest a fix</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="-mr-1 cursor-pointer rounded p-1 text-stone-light transition-colors hover:text-stone"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="mb-3 text-sm text-stone">
        Wrong time, a changed lineup, a better poster? Tell us, nothing changes on the site until we
        review it.
      </p>
      <ReportEventForm slug={slug} eventName={eventName} variant="inline" />
    </div>
  );
}
