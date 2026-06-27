import Anthropic from "@anthropic-ai/sdk";

// Web research for the create_venue_row proposer (PRD-live-music-experience.md
// Phase 1A). Finds a venue's verified street address so the proposal arrives
// pre-filled — the human just verifies and approves. The address is Tier A in the
// accuracy contract (verified, auto-fillable), so the model is told to return null
// + low confidence when unsure rather than guess a plausible-but-wrong address.
//
// Same Anthropic web_search + Sonnet pattern as lib/agent/research-org.ts. Distinct
// because the target is different: an org's canonical events URL there, a postal
// street address here.

export const RESEARCH_MODEL = "claude-sonnet-4-6";

export type VenueResearch = {
  address: string | null; // full street address: "1154 Pennsylvania Gulch Rd, Murphys, CA 95247"
  confidence: "high" | "medium" | "low";
  notes: string | null;
  sources: { title: string; url: string }[];
};

const SYSTEM = `You find the verified street address of a local venue in the Highway 4 corridor of Calaveras County, California (towns: Angels Camp, Copperopolis, Murphys, Arnold, Avery, Camp Connell, Dorrington, White Pines, Bear Valley).

Given a venue name and town, find the venue's full postal street address.

Hard rules:
- Return a complete street address with house number, street, city, state, and ZIP when you can verify it (e.g. "1154 Pennsylvania Gulch Rd, Murphys, CA 95247").
- Only return an address you actually found and verified belongs to THIS venue. If you are not sure, return null and confidence "low". A wrong address is worse than no address — it would drop a map pin in the wrong place.
- The venue must be in or very near one of the corridor towns above. If the only match you find is elsewhere (a different county or state), return null.
- Set confidence "high" only when multiple sources agree on the address; "medium" if one credible source has it; "low" otherwise.

Return ONLY JSON, no prose:
{"address": string|null, "confidence": "high"|"medium"|"low", "notes": string|null, "sources": [{"title": string, "url": string}]}`;

function safeJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// A plausible US street address: leading house number + street, with a CA marker.
// Defensive floor so a vague "in downtown Murphys" doesn't slip through as an address.
const LOOKS_LIKE_ADDRESS = /^\d+[A-Za-z]?\s+\S+.*\b(CA|California)\b/i;

function coerce(o: unknown): VenueResearch {
  const empty: VenueResearch = { address: null, confidence: "low", notes: null, sources: [] };
  if (!o || typeof o !== "object") return empty;
  const obj = o as Record<string, unknown>;

  let address = typeof obj.address === "string" ? obj.address.trim() : null;
  if (address && !LOOKS_LIKE_ADDRESS.test(address)) address = null;

  const conf = obj.confidence === "high" || obj.confidence === "medium" ? obj.confidence : "low";
  const sources = Array.isArray(obj.sources)
    ? obj.sources
        .filter(
          (s): s is { url: string; title?: unknown } =>
            Boolean(s) && typeof s === "object" && typeof (s as { url?: unknown }).url === "string"
        )
        .map((s) => ({ title: String((s as { title?: unknown }).title ?? ""), url: String(s.url) }))
        .slice(0, 5)
    : [];

  return {
    address,
    confidence: address ? conf : "low",
    notes: typeof obj.notes === "string" ? obj.notes.trim() || null : null,
    sources,
  };
}

export async function researchVenueAddress(
  venue: string,
  town: string | null
): Promise<VenueResearch> {
  const anthropic = new Anthropic();
  const userMsg = `Venue: "${venue}"${
    town ? ` in ${town}, CA` : " (Calaveras County, CA)"
  }. Find this venue's full street address. Research the web and return the JSON.`;

  const message = await anthropic.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 1000,
    system: SYSTEM,
    // web_search_20250305 is an Anthropic server tool executed during the call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as any],
    messages: [{ role: "user", content: userMsg }],
  });

  const text = message.content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.type === "text")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text)
    .join("\n");

  return coerce(safeJson(text));
}
