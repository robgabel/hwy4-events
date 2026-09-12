import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { MEET_ME_GUIDES } from "@/lib/meet-me-pages";
import MeetMePageView from "@/components/MeetMePageView";

const guide = MEET_ME_GUIDES.find((g) => g.key === "meet-me-in-murphys")!;

// Revalidate hourly so a newly confirmed date appears without a deploy.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: guide.metaTitle,
  description: guide.metaDescription,
  alternates: { canonical: guide.path },
  openGraph: {
    title: guide.metaTitle,
    description: guide.metaDescription,
    type: "website",
    url: `${SITE_URL}${guide.path}`,
  },
  twitter: {
    card: "summary_large_image",
    title: guide.metaTitle,
    description: guide.metaDescription,
  },
};

export default function MeetMeInMurphysPage() {
  return <MeetMePageView guide={guide} />;
}
