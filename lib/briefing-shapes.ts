// Structural rotation for Millie's daily briefing (WS-6). A daily reader pattern-
// matches "Tuesday's got a tidy little arc / Wednesday spreads out" within two
// weeks, so we rotate the briefing's SHAPE deterministically by day-of-year and
// hand the model the last several openers to avoid echoing them.
//
// content/briefing-shapes.md documents these for humans; this file is the source
// the prompt actually uses.

export interface BriefingShape {
  id: string;
  name: string;
  guidance: string;
}

export const BRIEFING_SHAPES: BriefingShape[] = [
  {
    id: "chronological",
    name: "Chronological walk",
    guidance:
      "Walk the days in order (today, then tomorrow, then later in the week). Vary the connecting verbs; don't reuse 'brings' / 'spreads out' / 'has a tidy little arc'.",
  },
  {
    id: "headliner",
    name: "One headliner plus the rest",
    guidance:
      "Lead with the single best event and give it two sentences. Sweep everything else into one tight sentence after it.",
  },
  {
    id: "audience-cut",
    name: "Audience cut",
    guidance:
      "Sort by who it's for, not by day. Two or three short address-the-reader beats: the kids-day pick, the barstool pick, the get-outside pick. Pick the two or three that actually have events.",
  },
  {
    id: "logistics-first",
    name: "Logistics-first",
    guidance:
      "Open with the practical heads-up (what needs a reservation, what sells out, what's free), then name the events around it. Example shape: 'Two things need a reservation this week; everything else you can wing.'",
  },
];

/** Day of year (1-366) in the server's local time. Drives the deterministic shape. */
export function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

/** Deterministic shape for the day. dayOfYear % 4 — no repeats on consecutive days. */
export function selectBriefingShape(doy: number): BriefingShape {
  return BRIEFING_SHAPES[((doy % BRIEFING_SHAPES.length) + BRIEFING_SHAPES.length) % BRIEFING_SHAPES.length];
}

/** First few words of each recent briefing — the "opening construction" to avoid. */
export function recentOpeners(texts: string[], words = 6): string[] {
  return texts
    .map((t) => {
      const firstLine = (t || "").trim().split(/\n/)[0] ?? "";
      return firstLine.split(/\s+/).slice(0, words).join(" ").trim();
    })
    .filter((o) => o.length > 0);
}

/** The block appended to the briefing user prompt: today's shape + openers to dodge. */
export function buildBriefingShapeGuidance(shape: BriefingShape, openers: string[]): string {
  const avoid =
    openers.length > 0
      ? `\n\nDo NOT open with any of these recent constructions (vary your first sentence):\n${openers
          .map((o) => `- "${o}..."`)
          .join("\n")}`
      : "";
  return `\n\nSTRUCTURE FOR TODAY — ${shape.name}: ${shape.guidance}${avoid}`;
}

/** First 3 words, normalized — used to detect a repeated opener day-to-day. */
export function openerKey(text: string): string {
  return (text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}
