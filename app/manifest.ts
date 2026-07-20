import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/constants";
import { REGION } from "@/lib/region";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — ${REGION.titleSuffix}`,
    short_name: SITE_NAME,
    description: REGION.manifestDescription,
    start_url: "/",
    display: "standalone",
    background_color: REGION.theme.backgroundColor,
    theme_color: REGION.theme.themeColor,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
