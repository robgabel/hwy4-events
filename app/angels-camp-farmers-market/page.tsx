import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { MARKET_GUIDES } from "@/lib/market-pages";
import MarketPageView from "@/components/MarketPageView";

const guide = MARKET_GUIDES.find((g) => g.key === "angels-camp-farmers-market")!;

// Revalidate hourly so the season's remaining dates stay fresh without
// per-request cost (same cadence as the holiday guides).
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

export default function AngelsCampFarmersMarketPage() {
  return <MarketPageView guide={guide} />;
}
