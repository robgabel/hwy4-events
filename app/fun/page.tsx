// /fun — The Tile Room. An unlisted amusement: 4-seat Rummikub scoring with a
// 120-second turn clock, dressed like a 1920s coastal club. Deliberately not
// linked from anywhere on the site and excluded from sitemaps + indexing.
import type { Metadata } from "next";
import { Cormorant_Garamond } from "next/font/google";
import TileRoom from "./TileRoom";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-club",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Tile Room",
  description: "Rummikub scoring and a 120-second turn clock.",
  robots: { index: false, follow: false },
};

export default function FunPage() {
  return (
    <div className={cormorant.variable}>
      <TileRoom />
    </div>
  );
}
