import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { TEMPORAL_CONFIG } from "@/lib/date-windows";
import TemporalEventsView from "@/components/TemporalEventsView";

const cfg = TEMPORAL_CONFIG.month;

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

export default function ThisMonthPage() {
  return <TemporalEventsView windowKey="month" />;
}
