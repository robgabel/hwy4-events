"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

const OPT_OUT_KEY = "hwy4_noanalytics";

// Cloudflare Web Analytics has no native IP exclusion. Visiting the site with
// ?noanalytics sets a localStorage flag that suppresses the beacon on this
// device from then on (?analytics re-enables it).
export default function CloudflareAnalytics({ token }: { token: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("noanalytics")) {
      localStorage.setItem(OPT_OUT_KEY, "1");
    } else if (params.has("analytics")) {
      localStorage.removeItem(OPT_OUT_KEY);
    }
    setEnabled(localStorage.getItem(OPT_OUT_KEY) !== "1");
  }, []);

  if (!enabled) return null;

  return (
    <Script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={`{"token": "${token}"}`}
      strategy="afterInteractive"
    />
  );
}
