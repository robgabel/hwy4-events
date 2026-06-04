"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Fires a single share-attribution beacon when a visitor lands on an event
 * page through a tracked link (?src=share|qr|pdf|download, optional ?via=<org>).
 *
 * ISR-safe by design: it reads the query string on the client, so the event
 * page itself stays statically rendered (revalidate=3600). Best-effort — any
 * failure is swallowed. Must be rendered inside a <Suspense> boundary because
 * it uses useSearchParams().
 */
export default function ShareTracker({ slug }: { slug: string }) {
  const params = useSearchParams();

  useEffect(() => {
    const src = params.get("src");
    if (!src) return;

    const body = JSON.stringify({
      slug,
      src,
      via: params.get("via"),
      referrer: typeof document !== "undefined" ? document.referrer : null,
    });

    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/track-share",
          new Blob([body], { type: "application/json" })
        );
      } else {
        fetch("/api/track-share", {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        });
      }
    } catch {
      // best-effort attribution; ignore
    }
  }, [params, slug]);

  return null;
}
