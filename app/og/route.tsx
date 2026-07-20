import { ImageResponse } from "next/og";
import { REGION } from "@/lib/region";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1a3a2a 0%, #2d5a3f 50%, #1a3a2a 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <span style={{ fontSize: "48px" }}>🌲</span>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 500,
              letterSpacing: "0.25em",
              textTransform: "uppercase" as const,
              color: "rgba(200, 215, 200, 0.8)",
            }}
          >
            {REGION.og.kicker}
          </span>
          <span style={{ fontSize: "48px" }}>🌲</span>
        </div>

        <div
          style={{
            fontSize: "64px",
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.02em",
          }}
        >
          {REGION.siteName}
        </div>

        <div
          style={{
            fontSize: "24px",
            color: "rgba(200, 215, 200, 0.9)",
            marginTop: "16px",
            textAlign: "center",
          }}
        >
          {REGION.og.townsLine}
        </div>

        <div
          style={{
            fontSize: "18px",
            color: "rgba(200, 215, 200, 0.6)",
            marginTop: "8px",
          }}
        >
          {REGION.og.subline}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      // Static, paramless image — let the CDN serve it instead of re-rendering
      // on every social-card crawl.
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
