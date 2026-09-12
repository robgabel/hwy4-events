import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import {
  LIVE_MUSIC_LENSES,
  LIVE_MUSIC_PATH,
  parseLiveMusicLens,
} from "@/lib/live-music";
import LiveMusicView from "@/components/LiveMusicView";

// Match the events-cache window so tonight drops ended shows with the feed.
export const revalidate = 1800;

type Search = Promise<{ when?: string }>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const { when } = await searchParams;
  const lens = parseLiveMusicLens(when);
  const cfg = LIVE_MUSIC_LENSES[lens];
  return {
    title: cfg.metaTitle,
    description: cfg.metaDescription,
    alternates: { canonical: LIVE_MUSIC_PATH },
    openGraph: {
      title: cfg.metaTitle,
      description: cfg.metaDescription,
      type: "website",
      url: `${SITE_URL}${LIVE_MUSIC_PATH}`,
    },
    twitter: {
      card: "summary_large_image",
      title: cfg.metaTitle,
      description: cfg.metaDescription,
    },
  };
}

export default async function LiveMusicPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { when } = await searchParams;
  return <LiveMusicView lens={parseLiveMusicLens(when)} />;
}
