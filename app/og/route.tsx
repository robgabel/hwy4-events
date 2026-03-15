import { ImageResponse } from "next/og";

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
          position: "relative",
          overflow: "hidden",
          fontFamily: "system-ui, sans-serif",
          background:
            "linear-gradient(180deg, #1B3A4B 0%, #2D5A3D 35%, #4A7C59 60%, #8B9E7E 85%, #C4B8AA 100%)",
        }}
      >
        {/* Mountain silhouettes - back range */}
        <div
          style={{
            position: "absolute",
            bottom: "120px",
            left: 0,
            width: "100%",
            height: "280px",
            display: "flex",
          }}
        >
          <svg
            viewBox="0 0 1200 280"
            style={{ width: "100%", height: "100%" }}
          >
            <path
              d="M0 280 L0 180 Q100 60 200 140 Q280 40 360 120 Q420 20 500 100 Q560 10 640 90 Q720 30 800 110 Q860 50 940 130 Q1020 40 1100 120 Q1150 80 1200 150 L1200 280 Z"
              fill="rgba(30, 60, 45, 0.6)"
            />
          </svg>
        </div>

        {/* Mountain silhouettes - front range */}
        <div
          style={{
            position: "absolute",
            bottom: "80px",
            left: 0,
            width: "100%",
            height: "240px",
            display: "flex",
          }}
        >
          <svg
            viewBox="0 0 1200 240"
            style={{ width: "100%", height: "100%" }}
          >
            <path
              d="M0 240 L0 160 Q80 100 160 140 Q240 80 340 130 Q400 70 480 120 Q560 60 660 110 Q740 50 840 100 Q920 70 1000 120 Q1080 90 1200 130 L1200 240 Z"
              fill="rgba(45, 90, 61, 0.5)"
            />
          </svg>
        </div>

        {/* Tree silhouettes along the bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            height: "140px",
            display: "flex",
          }}
        >
          <svg
            viewBox="0 0 1200 140"
            style={{ width: "100%", height: "100%" }}
          >
            {/* Ground */}
            <rect x="0" y="100" width="1200" height="40" fill="#1a2f1e" />
            {/* Trees */}
            <polygon points="40,100 55,30 70,100" fill="#1a3a2a" />
            <polygon points="90,100 110,15 130,100" fill="#1e3e2e" />
            <polygon points="160,100 180,25 200,100" fill="#1a3a2a" />
            <polygon points="230,100 242,40 254,100" fill="#1e3e2e" />
            <polygon points="290,100 310,10 330,100" fill="#1a3a2a" />
            <polygon points="360,100 375,35 390,100" fill="#1e3e2e" />
            <polygon points="420,100 440,20 460,100" fill="#1a3a2a" />
            <polygon points="500,100 515,30 530,100" fill="#1e3e2e" />
            <polygon points="560,100 580,15 600,100" fill="#1a3a2a" />
            <polygon points="640,100 655,40 670,100" fill="#1e3e2e" />
            <polygon points="700,100 720,10 740,100" fill="#1a3a2a" />
            <polygon points="770,100 785,30 800,100" fill="#1e3e2e" />
            <polygon points="830,100 850,20 870,100" fill="#1a3a2a" />
            <polygon points="910,100 925,35 940,100" fill="#1e3e2e" />
            <polygon points="970,100 990,15 1010,100" fill="#1a3a2a" />
            <polygon points="1050,100 1065,25 1080,100" fill="#1e3e2e" />
            <polygon points="1120,100 1140,10 1160,100" fill="#1a3a2a" />
          </svg>
        </div>

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            paddingBottom: "80px",
            zIndex: 1,
          }}
        >
          {/* Subtle top label */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "1px",
                background: "rgba(180, 196, 168, 0.5)",
              }}
            />
            <span
              style={{
                fontSize: "16px",
                fontWeight: 500,
                letterSpacing: "0.3em",
                textTransform: "uppercase" as const,
                color: "rgba(180, 196, 168, 0.8)",
              }}
            >
              Highway 4 Corridor
            </span>
            <div
              style={{
                width: "40px",
                height: "1px",
                background: "rgba(180, 196, 168, 0.5)",
              }}
            />
          </div>

          {/* Main title */}
          <div
            style={{
              fontSize: "72px",
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-0.02em",
              textShadow: "0 2px 20px rgba(0,0,0,0.3)",
            }}
          >
            Hwy 4 Events
          </div>

          {/* Town names */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginTop: "20px",
              fontSize: "22px",
              color: "rgba(220, 230, 215, 0.9)",
              fontWeight: 500,
            }}
          >
            <span>Angels Camp</span>
            <span style={{ color: "rgba(180, 196, 168, 0.5)" }}>·</span>
            <span>Murphys</span>
            <span style={{ color: "rgba(180, 196, 168, 0.5)" }}>·</span>
            <span>Arnold</span>
            <span style={{ color: "rgba(180, 196, 168, 0.5)" }}>·</span>
            <span>Bear Valley</span>
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: "17px",
              color: "rgba(180, 196, 168, 0.7)",
              marginTop: "12px",
              fontWeight: 400,
            }}
          >
            Live music, festivals & community events in the Sierra foothills
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
