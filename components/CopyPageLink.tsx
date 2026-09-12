"use client";

import { useRef, useState } from "react";
import { copyText } from "@/lib/copy-text";

// Copy-first share control for guest-facing pages. ShareButton opens the
// native share sheet when it can; Karen's job is paste-into-Airbnb, so this
// one writes the URL and says so. If both clipboard paths fail, the URL
// field appears selected so she can copy by hand.

export default function CopyPageLink({
  url,
  label = "Copy link",
}: {
  url: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  async function copy() {
    const ok = await copyText(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setReveal(true);
    requestAnimationFrame(() => fieldRef.current?.select());
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-pine/30 bg-white px-3 py-1.5 text-sm font-medium text-pine transition-colors hover:border-pine hover:bg-pine/5"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          {copied ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          )}
        </svg>
        {copied ? "Copied" : label}
      </button>
      {reveal && (
        <input
          ref={fieldRef}
          readOnly
          value={url}
          aria-label="Page link"
          className="mt-2 w-full max-w-md rounded-lg border border-stone-light/40 bg-white px-3 py-1.5 text-xs text-stone-800 focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </>
  );
}
