import Anthropic from "@anthropic-ai/sdk";
import { findBannedPhrase, withVoice } from "@/lib/voice";

// Web research for the artist-blurb drafter (PRD-artist-descriptions.md, Phase 1).
// Given a band/act name (as it appears in an event's `artists` field) plus the
// corridor town it's playing, find the act's own site/social links and, ONLY when
// one act clearly matches, a short genre tag + a two-sentence local-voice blurb.
//
// This is the accuracy contract's hard part: a name like "Surf Creeps" or "Overdrive"
// can match several unrelated bands, and a confident-wrong bio is worse than a blank.
// So the model is told to err on nothing, and the coercion floor below ENFORCES it in
// code (not just the prompt): a "low" confidence or a sourceless result drops the
// prose and genre to null. We keep a link only when we're confident it's the right act.
//
// Same Anthropic web_search + Sonnet pattern as lib/agent/research-venue.ts.

export const RESEARCH_MODEL = "claude-sonnet-4-6";

export type ArtistLinks = {
  website?: string;
  facebook?: string;
  spotify?: string;
  bandcamp?: string;
  instagram?: string;
};

export type ArtistResearch = {
  blurb: string | null; // two sentences, our voice, or null when not confident
  genre: string | null; // short tag: "Classic rock covers", "Americana"
  hometown: string | null; // "Murphys, CA" when known
  isLocal: boolean; // based in the corridor / Calaveras / Sierra foothills
  links: ArtistLinks; // own site / socials — kept only when confident it's this act
  confidence: "high" | "medium" | "low";
  notes: string | null;
  sources: { title: string; url: string }[];
};

const BASE_SYSTEM = `You research a live-music act (band or solo performer) that is playing a show in the Highway 4 corridor of Calaveras County, California (towns: Angels Camp, Copperopolis, Murphys, Arnold, Avery, Camp Connell, Dorrington, White Pines, Bear Valley). These are mostly small local, regional, and cover acts.

You are given the act's name (exactly as a venue listed it) and the town of the show. Find:
1. The act's own website and/or social pages (Facebook, Spotify, Bandcamp, Instagram).
2. A short genre tag (e.g. "Classic rock covers", "Americana", "Country", "Bluegrass").
3. A two-sentence description in a warm, local, plain-spoken neighbor voice: who they are and what they sound like. Name real specifics (where they're from, the kind of songs they play) only if you actually found them.

THE MOST IMPORTANT RULE — err on the side of nothing:
- Many of these names are generic and match several unrelated bands. If you cannot tie the name to ONE specific act with a corroborating signal (their own site, or a listing showing THIS act playing this region/venue), return blurb=null, genre=null, links={}, and confidence "low". A wrong band's bio is worse than a blank.
- Never invent a genre, a hometown, band members, a formation year, or a sound. If you didn't find it, leave it out.

EVERY CLAUSE MUST TRACE TO A SOURCE:
The rule above governs WHETHER to write a blurb. This one governs what goes INSIDE it. Deciding an act is identifiable does not license filling the sentences out with plausible detail.
- Every individual claim must trace to something you actually read: solo act vs full band, originals vs covers, hometown, influences, venues, festivals, awards. A detail that merely sounds right for the genre is an invention.
- Two real failures to avoid, both of which read as confident fact and both of which were wrong: describing a solo project as "his full band", and calling an act "all original" when their own page also advertised a cover repertoire.
- Many corridor acts are cover bands, and that is not a knock. If they play covers, say so plainly; do not upgrade them to original artists.
- If a detail would make the sentence better but you did not find it, write the shorter sentence.
- Prefer the act's OWN self-description (their site's wording for their genre and home region) over a third-party listing's paraphrase.
- Only include a link you are confident belongs to THIS act (the one playing a Calaveras/Sierra show). When in doubt, omit the link.
- Prefer acts that are clearly local or regional (Calaveras County, the Sierra foothills, the greater Sacramento/Bay Area/Tahoe orbit that tours here). If the only match you find is a famous unrelated national band with the same name, that's almost certainly NOT this act — return nothing.

Confidence:
- "high": the act's own site/socials found AND a listing corroborates it plays this region.
- "medium": one credible source clearly identifies the act.
- "low": ambiguous, generic, or not found — return nulls.

Set is_local=true only when the act is based in the corridor, Calaveras County, or the immediate Sierra foothills, and give hometown when you know it.

The blurb must follow the site's voice rules (no em dashes, no corporate phrasing, no references to "the data"/"my sources"/internal tooling). Keep it to two sentences.

Return ONLY JSON, no prose:
{"blurb": string|null, "genre": string|null, "hometown": string|null, "is_local": boolean, "links": {"website"?: string, "facebook"?: string, "spotify"?: string, "bandcamp"?: string, "instagram"?: string}, "confidence": "high"|"medium"|"low", "notes": string|null, "sources": [{"title": string, "url": string}]}`;

const SYSTEM = withVoice(BASE_SYSTEM);

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

function cleanUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : undefined;
}

function coerceLinks(o: unknown): ArtistLinks {
  if (!o || typeof o !== "object") return {};
  const obj = o as Record<string, unknown>;
  const out: ArtistLinks = {};
  for (const key of ["website", "facebook", "spotify", "bandcamp", "instagram"] as const) {
    const u = cleanUrl(obj[key]);
    if (u) out[key] = u;
  }
  return out;
}

function coerce(o: unknown): ArtistResearch {
  const empty: ArtistResearch = {
    blurb: null,
    genre: null,
    hometown: null,
    isLocal: false,
    links: {},
    confidence: "low",
    notes: null,
    sources: [],
  };
  if (!o || typeof o !== "object") return empty;
  const obj = o as Record<string, unknown>;

  const confidence =
    obj.confidence === "high" || obj.confidence === "medium" ? obj.confidence : "low";

  const sources = Array.isArray(obj.sources)
    ? obj.sources
        .filter(
          (s): s is { url: string; title?: unknown } =>
            Boolean(s) && typeof s === "object" && typeof (s as { url?: unknown }).url === "string"
        )
        .map((s) => ({ title: String((s as { title?: unknown }).title ?? ""), url: String(s.url) }))
        .slice(0, 5)
    : [];

  const links = coerceLinks(obj.links);

  // The conservative floor, enforced in code so a chatty model can't override it:
  // with no corroborating source, or low confidence, keep NOTHING but the fact that
  // we looked. A wrong band's description is worse than an empty one.
  const grounded = confidence !== "low" && sources.length > 0;

  let blurb = grounded && typeof obj.blurb === "string" ? obj.blurb.trim() || null : null;
  // Defensive voice floor: an em dash is a hard voice violation — drop rather than ship.
  if (blurb && blurb.includes("—")) blurb = null;
  // Same floor for the banned-phrase list: this path can publish UNATTENDED at
  // high confidence (lib/agent/artist-autopublish.ts), so its code-level voice
  // check must be at least as strong as the human-gated venue drafter's.
  if (blurb && findBannedPhrase(blurb)) blurb = null;

  const genre = grounded && typeof obj.genre === "string" ? obj.genre.trim() || null : null;
  const hometown = grounded && typeof obj.hometown === "string" ? obj.hometown.trim() || null : null;

  return {
    blurb,
    genre,
    hometown,
    isLocal: grounded && obj.is_local === true,
    // Links are attribution, not prose — keep them whenever the model was confident
    // enough to return a valid URL, even if the blurb didn't clear the bar. (Rob's
    // ask: always link out to the website/Facebook when we can.)
    links: confidence !== "low" ? links : {},
    confidence,
    notes: typeof obj.notes === "string" ? obj.notes.trim() || null : null,
    sources,
  };
}

export async function researchArtist(
  name: string,
  town: string | null
): Promise<ArtistResearch> {
  const anthropic = new Anthropic();
  const userMsg = `Act: "${name}", playing a show in ${
    town ? `${town}, CA` : "the Highway 4 corridor, Calaveras County, CA"
  }. Research the web for this act's own site/socials, genre, and a two-sentence local-voice description. Remember: if you cannot confidently identify ONE specific act, return nulls. Return the JSON.`;

  const message = await anthropic.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 1200,
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
