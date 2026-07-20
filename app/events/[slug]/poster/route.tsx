import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { format, parseISO } from "date-fns";
import { findEventBySlug } from "@/lib/events";
import { REGION } from "@/lib/region";
import { posterKind, humanizeHost } from "@/lib/poster";
import { resolveDisplayAddress } from "@/lib/address";
import type { EventCategory, Hwy4Event } from "@/lib/types";
import QRCode from "qrcode";

// Node runtime so we can Buffer-encode the inline SVG art and load the bundled
// brand fonts via import.meta.url. Cached hard: a poster is a pure function of
// the event row, so it rarely needs regenerating. Because this handler reads
// req.url (origin), Next treats it as dynamic and the `revalidate` hint alone
// won't cache it — so every response below also carries an explicit
// Cache-Control so the Vercel CDN serves repeat/crawler hits without re-running
// Satori + QR + font loads each time (the CPU draw that tripped the plan cap).
export const runtime = "nodejs";
export const revalidate = 86400;

// CDN cache: a day at the edge, a week of stale-while-revalidate. Not immutable
// because an organizer poster-swap (or an edit) can change what should render;
// a swap sets image_url -> posterKind "supplied" -> this route redirects anyway.
const POSTER_CACHE =
  "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

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
  fine_arts: { accent: C.gold, sky: "#efe6cf" },
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
// Canonical objects start from vetted Phosphor fill silhouettes (MIT)
// restyled to flat forest screenprint; bespoke local marks (frog, Big-Tree,
// string lights) are primitive-composed. Real geometry — no freehand bezier
// guessing, so no neck gaps / broken limbs / party-hat tents.
const motifWrap = (vb: string, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${inner}</svg>`;

function motifSvg(cat: EventCategory): string {
  switch (cat) {
    case "live_music": // acoustic guitar (Phosphor) under primitive string lights
      return motifWrap("0 0 256 256", `
        <path d="M14,46 Q128,104 242,46" fill="none" stroke="#3f6b4d" stroke-width="3"/>
        <g fill="#e3a72f" stroke="#3f6b4d" stroke-width="1.5"><circle cx="44" cy="62" r="7"/><circle cx="86" cy="80" r="7"/><circle cx="128" cy="88" r="7"/><circle cx="170" cy="80" r="7"/><circle cx="212" cy="62" r="7"/></g>
        <g transform="translate(6,40) scale(0.80)" fill="#1e3b2d"><path d="M249.66,46.34l-40-40a8,8,0,0,0-11.32,11.32L200.69,20,140.52,80.16C117.73,68.3,92.21,69.29,76.75,84.74a42.27,42.27,0,0,0-9.39,14.37A8.24,8.24,0,0,1,59.81,104c-14.59.49-27.26,5.72-36.65,15.11C11.08,131.22,6,148.6,8.74,168.07,11.4,186.7,21.07,205.15,36,220s33.34,24.56,52,27.22A71.13,71.13,0,0,0,98.1,248c15.32,0,28.83-5.23,38.76-15.16,9.39-9.39,14.62-22.06,15.11-36.65a8.24,8.24,0,0,1,4.92-7.55,42.22,42.22,0,0,0,14.37-9.39c15.45-15.46,16.44-41,4.58-63.77L236,55.31l2.34,2.35a8,8,0,0,0,11.32-11.32ZM135.8,159.79a28,28,0,1,1,0-39.59A28,28,0,0,1,135.8,159.79Z"/></g>`);
    case "festival": // Ferris wheel — fair / celebration (clean primitives)
      return motifWrap("0 0 256 256", `
        <g stroke="#1e3b2d" stroke-width="8" stroke-linecap="round"><line x1="92" y1="222" x2="128" y2="120"/><line x1="164" y1="222" x2="128" y2="120"/></g>
        <line x1="80" y1="224" x2="176" y2="224" stroke="#1e3b2d" stroke-width="8" stroke-linecap="round"/>
        <circle cx="128" cy="116" r="76" fill="none" stroke="#1e3b2d" stroke-width="9"/>
        <g stroke="#1e3b2d" stroke-width="4"><line x1="128" y1="116" x2="204" y2="116"/><line x1="128" y1="116" x2="182" y2="170"/><line x1="128" y1="116" x2="128" y2="192"/><line x1="128" y1="116" x2="74" y2="170"/><line x1="128" y1="116" x2="52" y2="116"/><line x1="128" y1="116" x2="74" y2="62"/><line x1="128" y1="116" x2="128" y2="40"/><line x1="128" y1="116" x2="182" y2="62"/></g>
        <g stroke="#1e3b2d" stroke-width="2"><circle cx="204" cy="116" r="11" fill="#e3a72f"/><circle cx="182" cy="170" r="11" fill="#c8642f"/><circle cx="128" cy="192" r="11" fill="#5b8c5a"/><circle cx="74" cy="170" r="11" fill="#e3a72f"/><circle cx="52" cy="116" r="11" fill="#c8642f"/><circle cx="74" cy="62" r="11" fill="#5b8c5a"/><circle cx="128" cy="40" r="11" fill="#e3a72f"/><circle cx="182" cy="62" r="11" fill="#c8642f"/></g>
        <circle cx="128" cy="116" r="10" fill="#1e3b2d"/>
        <line x1="128" y1="40" x2="128" y2="20" stroke="#1e3b2d" stroke-width="3"/>
        <path d="M128,20 l18,6 l-18,6 Z" fill="#c8642f"/>`);
    case "kids": // bespoke frog (kept)
      return motifWrap("0 0 200 168", `
        <path d="M28,150 q-14,-4 -6,-26 q6,-16 26,-12 q14,4 4,22 q-8,16 -24,16 Z" fill="#4f8a4c"/>
        <path d="M172,150 q14,-4 6,-26 q-6,-16 -26,-12 q-14,4 -4,22 q8,16 24,16 Z" fill="#4f8a4c"/>
        <path d="M100,38 C146,38 168,78 168,112 C168,146 138,160 100,160 C62,160 32,146 32,112 C32,78 54,38 100,38 Z" fill="#6aa45f"/>
        <ellipse cx="100" cy="124" rx="40" ry="30" fill="#cfe0a0"/>
        <circle cx="70" cy="46" r="22" fill="#6aa45f"/><circle cx="130" cy="46" r="22" fill="#6aa45f"/>
        <circle cx="70" cy="44" r="15" fill="#f4edda"/><circle cx="130" cy="44" r="15" fill="#f4edda"/>
        <circle cx="73" cy="46" r="7" fill="#1e3b2d"/><circle cx="127" cy="46" r="7" fill="#1e3b2d"/>
        <path d="M68,98 Q100,128 132,98" fill="none" stroke="#1e3b2d" stroke-width="4.5" stroke-linecap="round"/>`);
    case "wine": // Phosphor glass + primitive grape cluster
      return motifWrap("0 0 256 256", `
        <g transform="translate(-44,0) scale(0.92)" fill="#1e3b2d"><path d="M205.33,103.67,183.56,29.74A8,8,0,0,0,175.89,24H80.11a8,8,0,0,0-7.67,5.74L50.67,103.67a63.46,63.46,0,0,0,17.42,64.67A87.41,87.41,0,0,0,120,191.63V232H88a8,8,0,1,0,0,16h80a8,8,0,1,0,0-16H136V191.63a87.39,87.39,0,0,0,51.91-23.29A63.48,63.48,0,0,0,205.33,103.67ZM86.09,40h83.82L190,108.19c.09.3.17.6.25.9-21.42,7.68-45.54-1.6-58.63-8.23C106.43,88.11,86.43,86.49,71.68,88.93Z"/></g>
        <g stroke="#5a2139" stroke-width="2" fill="#7d3350"><circle cx="176" cy="150" r="15"/><circle cx="204" cy="146" r="15"/><circle cx="190" cy="174" r="15"/><circle cx="164" cy="176" r="15"/><circle cx="216" cy="174" r="15"/><circle cx="190" cy="200" r="15"/></g>
        <path d="M190,128 q-8,-22 12,-30 q5,16 -12,30Z" fill="#5b8c5a"/>`);
    case "games": // clean primitive dice (the knight was unfakeable freehand)
      return motifWrap("0 0 256 256", `
        <g transform="translate(-30,18) scale(0.62) rotate(-10 128 128)"><rect x="40" y="40" width="176" height="176" rx="34" fill="#1e3b2d"/><g fill="#f4edda"><circle cx="92" cy="92" r="12"/><circle cx="92" cy="164" r="12"/><circle cx="128" cy="128" r="12"/><circle cx="164" cy="92" r="12"/><circle cx="164" cy="164" r="12"/></g></g>
        <g transform="translate(96,70) scale(0.5) rotate(14 128 128)"><rect x="44" y="44" width="168" height="168" rx="34" fill="#2f5d43"/><g fill="#f4edda"><circle cx="92" cy="92" r="13"/><circle cx="164" cy="92" r="13"/><circle cx="92" cy="164" r="13"/><circle cx="164" cy="164" r="13"/></g></g>`);
    case "hike_walk": // Phosphor hiking boot
      return motifWrap("0 0 256 256", `
        <path transform="translate(0,16) scale(0.95)" fill="#1e3b2d" d="M192,112H112.27a8.17,8.17,0,0,1-8.25-7.47A8,8,0,0,1,112,96h44a4,4,0,0,0,4-4V84a4,4,0,0,0-4-4H112.27A8.17,8.17,0,0,1,104,72.53,8,8,0,0,1,112,64h44a4,4,0,0,0,4-4V56a16,16,0,0,0-16-16H32.22a8.23,8.23,0,0,0-5.08,1.64,8,8,0,0,0-2.61,9.22c11.06,28.84,8.76,83.71-.22,114.93A8,8,0,0,0,24,168v32a16,16,0,0,0,16,16H66.11a16,16,0,0,0,7.16-1.69L85.89,208h16.22l12.62,6.31a16,16,0,0,0,7.16,1.69h28.22a16,16,0,0,0,7.16-1.69L169.89,208h16.22l12.62,6.31a16,16,0,0,0,7.16,1.69H232a16,16,0,0,0,16-16V168A56,56,0,0,0,192,112Z"/>`);
    case "civic": // Phosphor "three people" — no neck gaps
      return motifWrap("0 0 256 256", `
        <path transform="translate(0,10) scale(0.96)" fill="#1e3b2d" d="M64.12,147.8a4,4,0,0,1-4,4.2H16a8,8,0,0,1-7.8-6.17,8.35,8.35,0,0,1,1.62-6.93A67.79,67.79,0,0,1,37,117.51a40,40,0,1,1,66.46-35.8,3.94,3.94,0,0,1-2.27,4.18A64.08,64.08,0,0,0,64,144C64,145.28,64,146.54,64.12,147.8Zm182-8.91A67.76,67.76,0,0,0,219,117.51a40,40,0,1,0-66.46-35.8,3.94,3.94,0,0,0,2.27,4.18A64.08,64.08,0,0,1,192,144c0,1.28,0,2.54-.12,3.8a4,4,0,0,0,4,4.2H240a8,8,0,0,0,7.8-6.17A8.33,8.33,0,0,0,246.17,138.89Zm-89,43.18a48,48,0,1,0-58.37,0A72.13,72.13,0,0,0,65.07,212,8,8,0,0,0,72,224H184a8,8,0,0,0,6.93-12A72.15,72.15,0,0,0,157.19,182.07Z"/>`);
    case "fine_arts": // painter's palette + brush (theater, pottery, painting)
      return motifWrap("0 0 256 256", `
        <path d="M128,28 C68,28 24,68 24,120 c0,40 32,60 60,60 16,0 22,-10 22,-22 0,-8 -6,-12 -6,-22 0,-12 10,-20 24,-20 h26 c40,0 54,-26 54,-52 C228,62 184,28 128,28 Z" fill="#1e3b2d"/>
        <g stroke="#1e3b2d" stroke-width="1.5"><circle cx="78" cy="86" r="11" fill="#c8642f"/><circle cx="120" cy="68" r="11" fill="#e3a72f"/><circle cx="166" cy="78" r="11" fill="#5b8c5a"/><circle cx="80" cy="132" r="11" fill="#7d3350"/></g>
        <g transform="translate(150,150) rotate(40 0 0)"><rect x="-6" y="0" width="12" height="70" rx="5" fill="#8a4b2f"/><path d="M-9,-22 h18 l-3,22 h-12 Z" fill="#e3a72f"/><rect x="-9" y="-30" width="18" height="10" rx="3" fill="#1e3b2d"/></g>`);
    default: // Big-Trees sequoia (bespoke, brand landmark) — wine/other fall here too
      return motifWrap("0 0 200 200", `
        <rect x="88" y="120" width="24" height="62" rx="4" fill="#8a4b2f"/>
        <path d="M100,28 L58,122 h84 Z" fill="#1e3b2d"/>
        <path d="M100,54 L66,124 h68 Z" fill="#2f5d43"/>
        <path d="M100,82 L76,132 h48 Z" fill="#2f5d43"/>`);
  }
}

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
  if (!event)
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "public, max-age=0, s-maxage=300" },
    });

  // Branding rule: never stamp the organizer's own art. If they supplied a
  // poster, redirect to it untouched rather than generating a branded one.
  if (posterKind(event) === "supplied" && event.image_url) {
    const res = NextResponse.redirect(event.image_url);
    res.headers.set(
      "Cache-Control",
      "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
    );
    return res;
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
  const host = humanizeHost(event.source_name, event.name);
  const free = event.cost_tier === "free";
  const firstSentence = (event.description || "").trim().split(/(?<=[.!?])\s/)[0] || "";
  // Teaser line: keep the whole first sentence when it's a sensible length (it
  // wraps to ~2 lines on the poster) and only truncate genuinely long ones —
  // always on a word boundary so a venue / proper noun never gets chopped
  // mid-word ("…at the Murphys…"). Longer taglines scale down to stay ~2 lines.
  const TAGLINE_MAX = 116;
  const tagline = firstSentence
    ? firstSentence.length > TAGLINE_MAX
      ? firstSentence.slice(0, TAGLINE_MAX).replace(/\s+\S*$/, "") + "…"
      : firstSentence
    : null;
  const taglineSize = tagline && tagline.length > 66 ? 32 : 38;

  // Venue ("Where" fact): word-boundary truncate only very long names and scale
  // the type down so the full venue wraps to two lines and reads in full
  // ("Murphys Volunteer Library") instead of "Murphys Volunte…".
  const venueName = event.venue_name || "";
  const venueDisplay =
    venueName.length > 34
      ? venueName.slice(0, 34).replace(/\s+\S*$/, "") + "…"
      : venueName;
  const venueSize = venueDisplay.length > 14 ? 28 : 38;

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
            <div style={{ display: "flex", justifyContent: "center", marginTop: 16, fontFamily: "Bitter", fontWeight: 700, fontSize: taglineSize, color: C.pine, textAlign: "center", lineHeight: 1.1 }}>
              {tagline}
            </div>
          )}

          {/* spacer pushes the bottom block down */}
          <div style={{ display: "flex", flexGrow: 1 }} />

          <div style={{ display: "flex", height: 4, backgroundColor: C.ink, opacity: 0.8, marginBottom: 30 }} />

          {/* facts */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            {([
              ["When", `${dow}, ${md}`, year, 38],
              ["Time", timeStr, "", 38],
              ["Where", venueDisplay, "", venueSize],
            ] as [string, string, string, number][]).map(([k, v, sub, fs], i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, flexBasis: 0, maxWidth: "34%" }}>
                <div style={labelStyle}>{k}</div>
                <div style={{ fontFamily: "Bitter", fontWeight: 700, fontSize: fs, color: C.ink, marginTop: 6, textAlign: "center", lineHeight: 1.05 }}>{v}</div>
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
                <div style={{ fontFamily: "DMSans", fontWeight: 600, fontSize: 26, color: C.ink }}>{REGION.domain}</div>
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
      headers: { "Cache-Control": POSTER_CACHE },
      fonts: [
        { name: "Bitter", data: b700, weight: 700, style: "normal" },
        { name: "Bitter", data: b900, weight: 900, style: "normal" },
        { name: "DMSans", data: d600, weight: 600, style: "normal" },
        { name: "DMSans", data: d700, weight: 700, style: "normal" },
      ],
    }
  );
}
