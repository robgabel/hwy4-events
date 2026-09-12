import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { TEMPORAL_CONFIG } from "@/lib/date-windows";
import TemporalEventsView from "@/components/TemporalEventsView";
import {
  parseStayRange,
  stayHref,
  stayMeta,
  stayOgPath,
} from "@/lib/stay-range";

const cfg = TEMPORAL_CONFIG.weekend;

// Revalidate hourly so the weekend window stays fresh without per-request cost.
export const revalidate = 3600;

type Search = Promise<{ from?: string; to?: string }>;

function weekendImages(ogPath: string, alt: string) {
  return [{ url: ogPath, width: 1200, height: 630, alt }];
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const { from, to } = await searchParams;
  const stay = parseStayRange({ from, to });
  if (stay) {
    const meta = stayMeta(stay);
    const path = stayHref(stay);
    const og = stayOgPath(stay);
    return {
      title: meta.title,
      description: meta.description,
      robots: { index: false, follow: true },
      alternates: { canonical: path },
      openGraph: {
        title: meta.title,
        description: meta.description,
        type: "website",
        url: `${SITE_URL}${path}`,
        images: weekendImages(og, `${meta.title} on the Highway 4 corridor`),
      },
      twitter: {
        card: "summary_large_image",
        title: meta.title,
        description: meta.description,
        images: [og],
      },
    };
  }

  const og = stayOgPath(null);
  return {
    title: cfg.metaTitle,
    description: cfg.metaDescription,
    alternates: { canonical: cfg.path },
    openGraph: {
      title: cfg.metaTitle,
      description: cfg.metaDescription,
      type: "website",
      url: `${SITE_URL}${cfg.path}`,
      images: weekendImages(og, "What's on this weekend on Hwy 4"),
    },
    twitter: {
      card: "summary_large_image",
      title: cfg.metaTitle,
      description: cfg.metaDescription,
      images: [og],
    },
  };
}

export default async function ThisWeekendPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { from, to } = await searchParams;
  return (
    <TemporalEventsView
      windowKey="weekend"
      stay={parseStayRange({ from, to })}
    />
  );
}
