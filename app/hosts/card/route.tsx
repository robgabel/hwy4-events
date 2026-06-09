import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { CORRIDOR_TOWNS } from "@/lib/towns";

// Printable "what's on this weekend" QR card for vacation-rental hosts to set
// out in the cabin (welcome book / counter card). Scans land on /this-weekend
// tagged ?src=host so the rental channel is attributable. Same Sierra
// screenprint DNA as the event poster (app/events/[slug]/poster/route.tsx),
// trimmed to a single evergreen call-to-scan. Node runtime + bundled brand
// fonts; cached a day (the card is evergreen — the page it points to is what
// changes). See /hosts and PRD-event-poster-loop.md for the loop it belongs to.

export const runtime = "nodejs";
export const revalidate = 86400;

// 5:7 portrait — prints cleanly as a 5x7 counter card / quarter-page flyer.
const W = 1080;
const H = 1512;

const C = {
  paper: "#f4edda",
  ink: "#1e3b2d",
  pine: "#2f5d43",
  gold: "#e3a72f",
  clay: "#c8642f",
  earth: "#8a4b2f",
  inkMuted: "#6b7d70",
  sky: "#dde7df",
};

const svgUri = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// The constant Sierra backdrop — brand DNA shared with the poster.
const LANDSCAPE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">
  <circle cx="316" cy="60" r="30" fill="#e3a72f"/>
  <g stroke="#e3a72f" stroke-width="4" stroke-linecap="round">
    <line x1="316" y1="14" x2="316" y2="2"/><line x1="356" y1="26" x2="364" y2="17"/>
    <line x1="276" y1="26" x2="268" y2="17"/><line x1="366" y1="60" x2="378" y2="60"/><line x1="266" y1="60" x2="254" y2="60"/>
  </g>
  <path d="M0,128 L54,86 L104,124 L168,70 L232,124 L300,84 L400,122 L400,220 L0,220 Z" fill="#7fae74"/>
  <path d="M0,160 L70,124 L140,158 L210,116 L286,156 L360,128 L400,150 L400,220 L0,220 Z" fill="#5b8c5a"/>
  <g fill="#2f5d43">
    <path d="M58,150 l-10,0 l10,-22 l10,22 Z M58,138 l-8,0 l8,-18 l8,18 Z"/>
    <path d="M120,156 l-11,0 l11,-24 l11,24 Z M120,143 l-9,0 l9,-20 l9,20 Z"/>
    <path d="M250,150 l-10,0 l10,-22 l10,22 Z M250,138 l-8,0 l8,-18 l8,18 Z"/>
  </g>
  <path d="M0,182 Q200,166 400,182 L400,220 L0,220 Z" fill="#2f5d43"/>
  <rect x="36" y="150" width="9" height="40" rx="2" fill="#8a4b2f"/><ellipse cx="40.5" cy="150" rx="20" ry="26" fill="#1e3b2d"/>
  <rect x="350" y="152" width="8" height="38" rx="2" fill="#8a4b2f"/><ellipse cx="354" cy="152" rx="17" ry="22" fill="#1e3b2d"/>
</svg>`;

// Millie (real asset, simplified for resvg) — shared with the poster lockup.
const MILLIE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 180">
  <g stroke="#1B3A2D" stroke-width="2" stroke-linejoin="round">
    <path d="M40 90 C35 85 30 75 32 65 C34 55 42 50 50 48 L110 48 C118 50 126 55 128 65 C130 75 125 85 120 90 L120 145 C120 152 115 155 108 155 L52 155 C45 155 40 152 40 145Z" fill="#1B3A2D"/>
    <path d="M55 65 C55 58 62 52 80 52 C98 52 105 58 105 65 L105 155 L55 155Z" fill="#fff"/>
    <path d="M28 45 C28 20 48 2 80 2 C112 2 132 20 132 45 C132 70 112 82 80 82 C48 82 28 70 28 45Z" fill="#fff"/>
    <path d="M95 15 C105 12 120 15 128 25 C132 32 130 42 125 48 C118 50 108 48 102 42 C96 36 94 25 95 15Z" fill="#1B3A2D"/>
    <path d="M35 30 C28 25 20 30 18 40 C16 50 20 60 28 62 C34 58 38 50 38 42Z" fill="#1B3A2D"/>
    <path d="M125 30 C132 25 140 30 142 40 C144 50 140 60 132 62 C126 58 122 50 122 42Z" fill="#1B3A2D"/>
    <circle cx="62" cy="40" r="5" fill="#1B3A2D"/><circle cx="98" cy="40" r="5" fill="#fff"/><circle cx="98" cy="40" r="3" fill="#1B3A2D"/>
    <ellipse cx="80" cy="55" rx="7" ry="5" fill="#1B3A2D"/>
    <path d="M70 62 C74 66 86 66 90 62 L90 64 C86 68 74 68 70 64Z" fill="#E8878C"/>
  </g></svg>`;

function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1e3b2d", light: "#ffffff" },
  });
}

let _fonts: Promise<ArrayBuffer[]> | null = null;
function loadFonts(base: string): Promise<ArrayBuffer[]> {
  if (!_fonts) {
    const get = (f: string) =>
      fetch(new URL(`/fonts/${f}`, base)).then((r) => r.arrayBuffer());
    _fonts = Promise.all([
      get("bitter-700.woff"),
      get("bitter-900.woff"),
      get("dmsans-600.woff"),
      get("dmsans-700.woff"),
    ]);
  }
  return _fonts;
}

const TOWN_NAMES = new Set(CORRIDOR_TOWNS.map((t) => t.name));

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const townParam = new URL(req.url).searchParams.get("town")?.trim() || "";
  // Only honor a real corridor town; anything else falls back to the
  // corridor-wide card so a bad query can't print a nonsense location.
  const town = TOWN_NAMES.has(townParam) ? townParam : "";

  const [b700, b900, d600, d700] = await loadFonts(origin);

  // The scan destination: the killer in-market view, tagged for attribution.
  const dest = `${origin}/this-weekend?src=host`;
  const qrMarkup = await qrSvg(dest);

  const kicker = town
    ? `For guests in ${town}`
    : "Angels Camp → Bear Valley";

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundImage: `linear-gradient(176deg, ${C.sky} 0%, ${C.paper} 48%)`,
          backgroundColor: C.paper,
          fontFamily: "Bitter",
          color: C.ink,
        }}
      >
        {/* letterpress frame */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: `7px solid ${C.ink}`,
            borderRadius: 10,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: "78px 76px 64px",
          }}
        >
          {/* kicker */}
          <div
            style={{
              display: "flex",
              fontFamily: "DMSans",
              fontWeight: 700,
              fontSize: 27,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: C.clay,
            }}
          >
            {kicker}
          </div>

          {/* headline */}
          <div
            style={{
              display: "flex",
              textAlign: "center",
              fontFamily: "Bitter",
              fontWeight: 900,
              fontSize: 92,
              lineHeight: 0.96,
              letterSpacing: -2,
              color: C.ink,
              marginTop: 18,
            }}
          >
            What&rsquo;s on this weekend?
          </div>

          {/* subhead */}
          <div
            style={{
              display: "flex",
              textAlign: "center",
              fontFamily: "Bitter",
              fontWeight: 700,
              fontSize: 33,
              lineHeight: 1.15,
              color: C.pine,
              marginTop: 22,
              maxWidth: 760,
            }}
          >
            Live music, festivals, and local happenings up and down Highway 4.
          </div>

          {/* scene */}
          <div style={{ display: "flex", position: "relative", height: 232, width: W - 152, marginTop: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgUri(LANDSCAPE)} width={W - 152} height={232} style={{ position: "absolute", left: 0, bottom: 0 }} alt="" />
          </div>

          {/* QR + scan-me */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={svgUri(qrMarkup)}
              width={300}
              height={300}
              style={{ backgroundColor: "#ffffff", padding: 18, border: `6px solid ${C.ink}`, borderRadius: 14 }}
              alt=""
            />
            <div
              style={{
                display: "flex",
                fontFamily: "DMSans",
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: C.ink,
                marginTop: 22,
              }}
            >
              Point your camera here
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: "Bitter",
                fontWeight: 700,
                fontSize: 28,
                color: C.inkMuted,
                marginTop: 6,
              }}
            >
              No app, no sign-up. Just this weekend&rsquo;s plans.
            </div>
          </div>

          {/* spacer */}
          <div style={{ display: "flex", flexGrow: 1 }} />

          {/* foot lockup */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", width: 84, height: 84, borderRadius: 42, backgroundColor: "#fff", boxShadow: `inset 0 0 0 4px ${C.ink}`, alignItems: "center", justifyContent: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svgUri(MILLIE)} width={66} height={74} alt="" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
              <div style={{ fontFamily: "DMSans", fontWeight: 700, fontSize: 18, letterSpacing: 2, textTransform: "uppercase", color: C.inkMuted }}>
                Your neighbor&rsquo;s guide to the 4
              </div>
              <div style={{ fontFamily: "DMSans", fontWeight: 600, fontSize: 30, color: C.ink }}>hwy4events.com</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Bitter", data: b700, weight: 700, style: "normal" },
        { name: "Bitter", data: b900, weight: 900, style: "normal" },
        { name: "DMSans", data: d600, weight: 600, style: "normal" },
        { name: "DMSans", data: d700, weight: 700, style: "normal" },
      ],
    }
  );
}
