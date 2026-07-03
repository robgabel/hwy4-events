import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { INTENT_CONFIG } from "@/lib/intent-pages";
import IntentPageView from "@/components/IntentPageView";

const cfg = INTENT_CONFIG["date-night"];

// Revalidate hourly so the window stays fresh without per-request cost.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: cfg.metaTitle,
  description: cfg.metaDescription,
  alternates: { canonical: cfg.path },
  openGraph: {
    title: cfg.metaTitle,
    description: cfg.metaDescription,
    type: "website",
    url: `${SITE_URL}${cfg.path}`,
  },
  twitter: {
    card: "summary_large_image",
    title: cfg.metaTitle,
    description: cfg.metaDescription,
  },
};

export default function DateNightPage() {
  return <IntentPageView intentKey="date-night" />;
}
