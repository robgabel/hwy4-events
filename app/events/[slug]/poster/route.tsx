import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { format, parseISO } from "date-fns";
import { findEventBySlug } from "@/lib/events";
import { posterKind } from "@/lib/poster";
import { resolveDisplayAddress } from "@/lib/address";
import type { EventCategory, Hwy4Event } from "@/lib/types";
import QRCode from "qrcode";

// Node runtime so we can Buffer-encode the inline SVG art and load the bundled
// brand fonts via import.meta.url. Cached hard: a poster is a pure function of
// the event row, so it rarely needs regenerating.
export const runtime = "nodejs";
export const revalidate = 86400;

const W = 1080;
const H = 1350;

// Sierra screenprint palette (literal — Satori has no CSS variables/color-mix).
const C = {
  paper: "#f4edda",
  ink: "#1e3b2d",
  pine: "#2f5d43",
  moss: "#5b8c5a",
  gold: "#e3a72f",
  clay: "#c8642f",
  earth: "#8a4b2f",
  slate: "#4f6d7a",
  wine: "#7d3350",
  inkMuted: "#6b7d70",
};

type Skin = { accent: string; sky: string };
const SKINS: Record<EventCategory, Skin> = {
  kids: { accent: C.gold, sky: "#d8e8e2" },
  games: { accent: C.slate, sky: "#dbe6ea" },
  live_music: { accent: C.clay, sky: "#ecdfca" },
  festival: { accent: C.gold, sky: "#efe6cf" },
  civic: { accent: C.moss, sky: "#e1e8d6" },
  hike_walk: { accent: C.pine, sky: "#dde7df" },
  wine: { accent: C.wine, sky: "#ece0e4" },
  other: { accent: C.earth, sky: "#e9e2d2" },
};

const svgUri = (svg: string) =>
  `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// --- the constant Sierra backdrop (brand DNA, identical on every poster) ----
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

// --- per-category motif (the one thing that swaps) -------------------------
function motifInner(cat: EventCategory): string {
  switch (cat) {
    case "kids":
      return `<g>
        <path d="M28,150 q-14,-4 -6,-26 q6,-16 26,-12 q14,4 4,22 q-8,16 -24,16 Z" fill="#4f8a4c"/>
        <path d="M172,150 q14,-4 6,-26 q-6,-16 -26,-12 q-14,4 -4,22 q8,16 24,16 Z" fill="#4f8a4c"/>
        <path d="M100,38 C146,38 168,78 168,112 C168,146 138,160 100,160 C62,160 32,146 32,112 C32,78 54,38 100,38 Z" fill="#6aa45f"/>
        <ellipse cx="100" cy="124" rx="40" ry="30" fill="#cfe0a0"/>
        <circle cx="70" cy="46" r="22" fill="#6aa45f"/><circle cx="130" cy="46" r="22" fill="#6aa45f"/>
        <circle cx="70" cy="44" r="15" fill="#f4edda"/><circle cx="130" cy="44" r="15" fill="#f4edda"/>
        <circle cx="73" cy="46" r="7" fill="#1e3b2d"/><circle cx="127" cy="46" r="7" fill="#1e3b2d"/>
        <path d="M68,98 Q100,128 132,98" fill="none" stroke="#1e3b2d" stroke-width="4.5" stroke-linecap="round"/>
      </g>`;
    case "games":
      return `<g fill="#1e3b2d">
        <path d="M58,176 h84 v-12 q0,-10 -12,-12 h-60 q-12,2 -12,12 Z"/><rect x="66" y="150" width="68" height="10" rx="3"/>
        <path d="M84,150 q-10,-30 6,-52 q-6,2 -12,-2 q4,-10 0,-18 q14,2 26,-10 q22,-22 42,2 q22,24 16,62 q-2,18 -10,18 Z"/>
        <circle cx="120" cy="78" r="5" fill="#f4edda"/></g>`;
    case "live_music":
    case "festival":
      return `<g>
        <rect x="92" y="120" width="16" height="44" fill="#1e3b2d"/><path d="M70,168 q30,-14 60,0 q-4,8 -30,8 q-26,0 -30,-8 Z" fill="#1e3b2d"/>
        <rect x="64" y="30" width="72" height="100" rx="36" fill="#1e3b2d"/>
        <g stroke="#f4edda" stroke-width="4"><line x1="74" y1="52" x2="126" y2="52"/><line x1="72" y1="66" x2="128" y2="66"/><line x1="72" y1="80" x2="128" y2="80"/><line x1="74" y1="94" x2="126" y2="94"/></g></g>`;
    case "wine":
      return `<g>
        <path d="M74,40 h52 l-6,40 a20,20 0 0 1 -40,0 Z" fill="#7d3350"/>
        <rect x="96" y="100" width="8" height="48" fill="#1e3b2d"/><rect x="74" y="150" width="52" height="9" rx="3" fill="#1e3b2d"/>
        <path d="M80,44 q20,18 40,0" fill="none" stroke="#f4edda" stroke-width="4"/></g>`;
    default:
      // Big Trees sequoia — the brand landmark, used for civic / hike / other.
      return `<g>
        <rect x="88" y="120" width="24" height="60" rx="4" fill="#8a4b2f"/>
        <path d="M100,30 L60,120 h80 Z" fill="#1e3b2d"/><path d="M100,55 L68,120 h64 Z" fill="#2f5d43"/>
        <path d="M100,80 L78,130 h44 Z" fill="#2f5d43"/></g>`;
  }
}
const motifSvg = (cat: EventCategory) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${motifInner(cat)}</svg>`;

// --- Millie (real asset, simplified for resvg) ------------------------------
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

// --- real QR: encodes the event URL with ?src=qr so scans are attributed -----
// Forest-on-cream to match the screenprint; the cream module color blends into
// the QR's framed cream box on the poster. Scans fine at print size.
function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1e3b2d", light: "#f4edda" },
  });
}

function formatTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "pm" : "am";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}${m && m !== "00" ? ":" + m : ""}${ampm}`;
}

// Brand fonts are served from /public/fonts and fetched over HTTP from the
// request's own origin — the portable next/og pattern (file-URL fetch isn't
// supported in the Node runtime). Memoized per process after the first load.
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const event = (await findEventBySlug(slug)) as Hwy4Event | null;
  if (!event) return new NextResponse("Not found", { status: 404 });

  // Branding rule: never stamp the organizer's own art. If they supplied a
  // poster, redirect to it untouched rather than generating a branded one.
  if (posterKind(event) === "supplied" && event.image_url) {
    return NextResponse.redirect(event.image_url);
  }

  const skin = SKINS[event.category] ?? SKINS.other;
  const origin = new URL(req.url).origin;
  const [b700, b900, d600, d700] = await loadFonts(origin);
  const qrMarkup = await qrSvg(`${origin}/events/${slug}?src=qr`);

  const dateObj = parseISO(event.date);
  const dow = format(dateObj, "EEE");
  const md = format(dateObj, "MMM d");
  const year = format(dateObj, "yyyy");
  const start = formatTime(event.start_time);
  const end = formatTime(event.end_time);
  const timeStr = start ? (end ? `${start}–${end}` : start) : "All day";
  const addr = resolveDisplayAddress(event.address, event.town);
  const host =
    event.source_name && !/gocalaveras|community submission/i.test(event.source_name)
      ? event.source_name
      : null;
  const free = event.cost_tier === "free";
  const firstSentence = (event.description || "").trim().split(/(?<=[.!?])\s/)[0] || "";
  const tagline = firstSentence
    ? firstSentence.length > 72
      ? firstSentence.slice(0, 72).replace(/\s+\S*$/, "") + "…"
      : firstSentence
    : null;

  const labelStyle = {
    fontFamily: "DMSans",
    fontWeight: 700,
    fontSize: 22,
    letterSpacing: 3,
    textTransform: "uppercase" as const,
    color: skin.accent,
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundImage: `linear-gradient(176deg, ${skin.sky} 0%, ${C.paper} 52%)`,
          backgroundColor: C.paper,
          fontFamily: "Bitter",
          color: C.ink,
        }}
      >
        {/* letterpress frame */}
        <div
          style={{
            position: "absolute",
            top: 26,
            left: 26,
            right: 26,
            bottom: 26,
            border: `7px solid ${C.ink}`,
            borderRadius: 10,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: "70px 74px 62px",
          }}
        >
          {/* kicker */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              fontFamily: "DMSans",
              fontWeight: 700,
              fontSize: 25,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: C.ink,
            }}
          >
            {`${event.town}, ${event.town === "Angels Camp" ? "Calaveras Co." : "CA"}`}
          </div>

          {/* scene: landscape + motif + seal */}
          <div style={{ display: "flex", position: "relative", height: 392, marginTop: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgUri(LANDSCAPE)} width={W - 148} height={392} style={{ position: "absolute", left: 0, bottom: 0 }} alt="" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgUri(motifSvg(event.category))} width={300} height={300} style={{ position: "absolute", left: (W - 148) / 2 - 150, bottom: 26 }} alt="" />
            {/* Free seal */}
            {free && (
              <div
                style={{
                  position: "absolute",
                  top: 34,
                  right: 8,
                  width: 178,
                  height: 178,
                  borderRadius: 89,
                  backgroundColor: skin.accent,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: "rotate(-13deg)",
                  boxShadow: `inset 0 0 0 6px ${C.paper}, inset 0 0 0 12px ${skin.accent}`,
                }}
              >
                <div style={{ fontFamily: "Bitter", fontWeight: 900, fontSize: 64, color: C.paper, lineHeight: 1 }}>FREE</div>
                <div style={{ fontFamily: "DMSans", fontWeight: 700, fontSize: 22, letterSpacing: 2, color: C.paper, textTransform: "uppercase", marginTop: 4 }}>
                  {event.category === "kids" ? "for kids" : "to enter"}
                </div>
              </div>
            )}
          </div>

          {/* title */}
          <div style={{ display: "flex", justifyContent: "center", textAlign: "center", marginTop: 4 }}>
            <div style={{ fontFamily: "Bitter", fontWeight: 900, fontSize: event.name.length > 22 ? 84 : 108, lineHeight: 0.92, letterSpacing: -2, color: C.ink }}>
              {event.name}
            </div>
          </div>

          {/* host */}
          {host && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 18, fontFamily: "DMSans", fontWeight: 700, fontSize: 26, letterSpacing: 2, textTransform: "uppercase", color: skin.accent, textAlign: "center" }}>
              {host}
            </div>
          )}

          {/* tagline */}
          {tagline && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 16, fontFamily: "Bitter", fontWeight: 700, fontSize: 38, color: C.pine, textAlign: "center", lineHeight: 1.1 }}>
              {tagline}
            </div>
          )}

          {/* spacer pushes the bottom block down */}
          <div style={{ display: "flex", flexGrow: 1 }} />

          <div style={{ display: "flex", height: 4, backgroundColor: C.ink, opacity: 0.8, marginBottom: 30 }} />

          {/* facts */}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            {[
              ["When", `${dow}, ${md}`, year],
              ["Time", timeStr, ""],
              ["Where", event.venue_name.length > 16 ? event.venue_name.slice(0, 15) + "…" : event.venue_name, ""],
            ].map(([k, v, sub], i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1 }}>
                <div style={labelStyle}>{k}</div>
                <div style={{ fontFamily: "Bitter", fontWeight: 700, fontSize: 38, color: C.ink, marginTop: 6 }}>{v}</div>
                {sub ? <div style={{ fontFamily: "DMSans", fontWeight: 600, fontSize: 25, color: C.inkMuted }}>{sub}</div> : null}
              </div>
            ))}
          </div>

          {/* address */}
          {addr && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 26, fontFamily: "DMSans", fontWeight: 600, fontSize: 28, color: C.pine, textAlign: "center" }}>
              {addr}
            </div>
          )}

          {/* foot: lockup (Millie + Poster by) bottom-aligned with the QR */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
              <div style={{ display: "flex", width: 90, height: 90, borderRadius: 45, backgroundColor: "#fff", boxShadow: `inset 0 0 0 4px ${C.ink}`, alignItems: "center", justifyContent: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={svgUri(MILLIE)} width={70} height={78} alt="" />
              </div>
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, paddingBottom: 4 }}>
                <div style={{ fontFamily: "DMSans", fontWeight: 700, fontSize: 19, letterSpacing: 2, textTransform: "uppercase", color: C.inkMuted }}>Poster by</div>
                <div style={{ fontFamily: "DMSans", fontWeight: 600, fontSize: 26, color: C.ink }}>hwy4events.com</div>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgUri(qrMarkup)} width={132} height={132} style={{ backgroundColor: C.paper, padding: 8, border: `4px solid ${C.ink}`, borderRadius: 8 }} alt="" />
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
