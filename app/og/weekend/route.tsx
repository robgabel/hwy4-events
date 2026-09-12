import { ImageResponse } from "next/og";
import { REGION } from "@/lib/region";
import { formatStayShort, parseStayRange } from "@/lib/stay-range";

export const runtime = "edge";

// Guest-share OG card for /this-weekend (HWY-40). Default is the weekend
// pitch; a valid ?from=&to= pair names those dates. Invalid params keep the
// weekend card so a junk query never mints a wrong date.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const stay = parseStayRange({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const headline = stay
    ? `What's on ${formatStayShort(stay)}`
    : "What's on this weekend";

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
          background:
            "linear-gradient(135deg, #1a3a2a 0%, #2d5a3f 50%, #1a3a2a 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <span style={{ fontSize: "40px" }}>🌲</span>
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
          <span style={{ fontSize: "40px" }}>🌲</span>
        </div>

        <div
          style={{
            fontSize: stay ? 56 : 64,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.02em",
            textAlign: "center",
            padding: "0 48px",
          }}
        >
          {headline}
        </div>

        <div
          style={{
            fontSize: "28px",
            color: "rgba(200, 215, 200, 0.95)",
            marginTop: "16px",
          }}
        >
          on Hwy 4
        </div>

        <div
          style={{
            fontSize: "20px",
            color: "rgba(200, 215, 200, 0.8)",
            marginTop: "20px",
            textAlign: "center",
          }}
        >
          {REGION.og.townsLine}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    }
  );
}
