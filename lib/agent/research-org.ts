import Anthropic from "@anthropic-ai/sdk";

// Web research for the create_org_row proposer (PRD-agent-cockpit.md, Stage 1.5).
// Finds a venue/organizer's OWN canonical events page so the proposal arrives
// pre-filled — the human just verifies and approves. Same Anthropic web_search +
// Sonnet pattern as submission-triage.ts. A wrong link is worse than none, so the
// model is told to return null + low confidence when unsure, and we defensively
// reject social/aggregator URLs after the fact.

export const RESEARCH_MODEL = "claude-sonnet-4-6";

export type OrgResearch = {
  canonical_url: string | null;
  confidence: "high" | "medium" | "low";
  display_name: string | null;
  notes: string | null;
  sources: { title: string; url: string }[];
};

const SYSTEM = `You find the official events/calendar page for a local venue or organizer in the Highway 4 corridor of Calaveras County, California (towns: Angels Camp, Copperopolis, Murphys, Arnold, Avery, Camp Connell, Dorrington, White Pines, Bear Valley).

Given a venue name and town, find the ORGANIZER'S OWN canonical events page — the page on their official website that lists their upcoming events. This is NOT an aggregator (gocalaveras.com, eventbrite, a Facebook event listing) and NOT a social profile.

Hard rules:
- Only return a URL you actually found and verified belongs to THIS venue and shows its events. If you are not sure, return null and confidence "low". A wrong link is worse than no link.
- A Facebook page / Instagram / X profile is NOT a canonical events page. Reject social URLs.
- Prefer a dedicated /events or /calendar page. A homepage is acceptable only if it carries the listings and there is no dedicated events page.
- Set confidence "high" only when you're confident the URL is the venue's own events page; "medium" if it's their site but you're unsure it's the events page; "low" otherwise.

Return ONLY JSON, no prose:
{"canonical_url": string|null, "confidence": "high"|"medium"|"low", "display_name": string|null, "notes": string|null, "sources": [{"title": string, "url": string}]}`;

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

const BAD_HOST = /facebook\.com|instagram\.com|gocalaveras\.com|eventbrite\.|twitter\.com|x\.com|linktr\.ee/i;

function coerce(o: unknown): OrgResearch {
  const empty: OrgResearch = {
    canonical_url: null,
    confidence: "low",
    display_name: null,
    notes: null,
    sources: [],
  };
  if (!o || typeof o !== "object") return empty;
  const obj = o as Record<string, unknown>;

  let url = typeof obj.canonical_url === "string" ? obj.canonical_url.trim() : null;
  // Defensive: reject social/aggregator URLs and non-http even if the model slipped.
  if (url && (BAD_HOST.test(url) || !/^https?:\/\//i.test(url))) url = null;

  const conf = obj.confidence === "high" || obj.confidence === "medium" ? obj.confidence : "low";
  const sources = Array.isArray(obj.sources)
    ? obj.sources
        .filter((s): s is { url: string; title?: unknown } => Boolean(s) && typeof s === "object" && typeof (s as { url?: unknown }).url === "string")
        .map((s) => ({ title: String((s as { title?: unknown }).title ?? ""), url: String(s.url) }))
        .slice(0, 5)
    : [];

  return {
    canonical_url: url,
    confidence: url ? conf : "low",
    display_name: typeof obj.display_name === "string" ? obj.display_name.trim() || null : null,
    notes: typeof obj.notes === "string" ? obj.notes.trim() || null : null,
    sources,
  };
}

export async function researchOrgCanonical(
  venue: string,
  town: string | null
): Promise<OrgResearch> {
  const anthropic = new Anthropic();
  const userMsg = `Venue: "${venue}"${
    town ? ` in ${town}, CA` : " (Calaveras County, CA)"
  }. Find this venue's official events/calendar page URL. Research the web and return the JSON.`;

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
