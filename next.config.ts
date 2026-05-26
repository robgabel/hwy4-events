import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "blsha.com" },
      { protocol: "https", hostname: "www.gocalaveras.com" },
      { protocol: "https", hostname: "www.thebistroespresso.com" },
      { protocol: "https", hostname: "visitmurphys.com" },
    ],
  },
};

export default nextConfig;
