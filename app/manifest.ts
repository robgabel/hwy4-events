import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hwy 4 Events — Sierra Nevada Foothills",
    short_name: "Hwy 4 Events",
    description:
      "Live music, festivals, and community events along the Highway 4 corridor in Calaveras County.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f5",
    theme_color: "#1a3a2a",
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
