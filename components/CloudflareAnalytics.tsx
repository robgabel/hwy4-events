"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

const OPT_OUT_KEY = "hwy4_noanalytics";

// Cloudflare Web Analytics has no native IP exclusion. Visiting the site with
// ?noanalytics sets a localStorage flag that suppresses the beacon on this
// device from then on (?analytics re-enables it). When opted out, a subtle
// footer-corner badge confirms analytics are off on this device.
export default function CloudflareAnalytics({ token }: { token: string }) {
  const [status, setStatus] = useState<"unknown" | "on" | "off">("unknown");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("noanalytics")) {
      localStorage.setItem(OPT_OUT_KEY, "1");
    } else if (params.has("analytics")) {
      localStorage.removeItem(OPT_OUT_KEY);
    }
    setStatus(localStorage.getItem(OPT_OUT_KEY) === "1" ? "off" : "on");
  }, []);

  if (status === "on") {
    return (
      <Script
        defer
        src="https://static.cloudflareinsights.com/beacon.min.js"
        data-cf-beacon={`{"token": "${token}"}`}
        strategy="afterInteractive"
      />
    );
  }

  if (status === "off") {
    return (
      <div
        className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full border border-stone-light/40 bg-white/90 px-2.5 py-1 text-xs text-stone shadow-sm backdrop-blur"
        title="Your visits aren't counted in analytics on this device. Visit ?analytics to re-enable."
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-stone-light" />
        Analytics off
      </div>
    );
  }

  return null;
}
