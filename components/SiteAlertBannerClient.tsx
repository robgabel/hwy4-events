"use client";

import { useEffect, useState } from "react";
import {
  isSiteAlertActive,
  isSiteAlertDismissed,
  SITE_ALERT_STORAGE_KEY,
  type SiteAlert,
} from "@/lib/site-alert";

/**
 * The visible banner. The server already decided it is inside the window, so
 * the first paint includes it (no layout shift for the common case). A small
 * inline script in the server parent hides it before paint when this browser
 * dismissed the same message, or when a cached page is past expiresAt.
 */
export default function SiteAlertBannerClient({ alert }: { alert: SiteAlert }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(SITE_ALERT_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (!isSiteAlertActive(alert, new Date()) || isSiteAlertDismissed(stored, alert.message)) {
      setVisible(false);
    }
  }, [alert]);

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(SITE_ALERT_STORAGE_KEY, alert.message);
    } catch {
      // Private mode: hide for this view even if we cannot persist it.
    }
    setVisible(false);
  }

  return (
    <div
      id="site-alert"
      role="alert"
      data-nosnippet=""
      className="border-t-[3px] border-b border-t-alert border-b-alert/25 bg-[#F8E4B8] text-forest"
    >
      <div className="mx-auto flex max-w-5xl items-start gap-3 px-4 py-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="mt-0.5 h-5 w-5 shrink-0 text-alert"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          />
        </svg>
        <p className="min-w-0 flex-1 text-base leading-snug">
          {alert.message}{" "}
          <a
            href={alert.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-alert underline decoration-alert/70 underline-offset-2 hover:decoration-alert focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alert"
          >
            {alert.link.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="cursor-pointer shrink-0 rounded-md px-2 py-1 text-sm font-medium text-earth underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alert"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
