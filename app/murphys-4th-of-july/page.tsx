import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { HOLIDAY_GUIDES } from "@/lib/holiday-pages";
import HolidayPageView from "@/components/HolidayPageView";

const guide = HOLIDAY_GUIDES.find((g) => g.key === "murphys-4th-of-july")!;

// Revalidate hourly so the July-window lineup stays fresh without per-request cost.
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

export default function MurphysFourthOfJulyPage() {
  return <HolidayPageView guide={guide} />;
}
