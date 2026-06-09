import Anthropic from "@anthropic-ai/sdk";
import { applyVenueDetection } from "./venue-matcher.js";
import { withVoice } from "../../lib/voice.js";

export interface ExtractedEvent {
  name: string;
  description: string | null;
  date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM (24h)
  end_time: string | null; // HH:MM (24h)
  venue_name: string;
  town: string;
  address: string | null;
  category: string;
  price: string | null;
  artists: string[] | null;
  event_url: string | null;
  image_url?: string | null;
  /**
   * Source-side stable id for this event (e.g. EventON event_id for
   * GoCalaveras). When present, the upsert path prefers this over the
   * computed dedup_key — so subsequent re-scrapes can update town/venue
   * changes in place rather than creating a duplicate.
   */
  source_event_id?: string | null;
}

const client = new Anthropic();

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&ldquo;": "\u201C",
  "&rdquo;": "\u201D",
  "&nbsp;": " ",
  "&hellip;": "\u2026",
};

function decodeHtmlEntities(str: string): string {
  // Decode numeric entities: &#8211; &#x2013;
  let decoded = str.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10))
  );
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  // Decode named entities
  decoded = decoded.replace(/&\w+;/g, (entity) =>
    NAMED_ENTITIES[entity.toLowerCase()] ?? entity
  );
  return decoded;
}

export function decodeEventFields(event: ExtractedEvent): ExtractedEvent {
  return {
    ...event,
    name: decodeHtmlEntities(event.name),
    description: event.description ? decodeHtmlEntities(event.description) : null,
    venue_name: decodeHtmlEntities(event.venue_name),
    price: event.price ? decodeHtmlEntities(event.price) : null,
    artists: event.artists?.map(decodeHtmlEntities) ?? null,
  };
}

export interface VenueContext {
  defaultVenue: string;
  defaultTown: string;
  defaultAddress?: string;
}

const DEFAULT_VENUE_CONTEXT: VenueContext = {
  defaultVenue: "Bear Valley Mountain Resort",
  defaultTown: "Bear Valley",
};

/**
 * Use Claude to extract structured events from unstructured page content.
 */
export async function extractEvents(
  title: string,
  url: string,
  content: string,
  year: number,
  venueContext?: VenueContext
): Promise<ExtractedEvent[]> {
  const ctx = venueContext ?? DEFAULT_VENUE_CONTEXT;
  const prompt = `Extract all discrete events from this venue's events page.
For each event, return JSON with these fields:

- name: Event name
- description: 1-2 sentence description
- date: ISO date (YYYY-MM-DD)
- start_time: HH:MM (24h) or null
- end_time: HH:MM (24h) or null
- venue_name: Specific venue if mentioned, else "${ctx.defaultVenue}"
- town: "${ctx.defaultTown}"
- address: Street address if mentioned, else ${ctx.defaultAddress ? `"${ctx.defaultAddress}"` : "null"}
- category: One of: live_music, festival, civic, hike_walk, kids, wine, games, fine_arts, other (describe WHAT the event is, not where: hike_walk = guided hikes/nature walks/trail runs; kids = kid-focused activities and camps; wine = wine tastings/blending/winery events; games = social/pub games like bingo/trivia/pool/bocce/cribbage; civic = community gatherings/markets/holiday meals; fine_arts = theater/plays, comedy, and visual/craft arts like pottery, ceramics, painting, drawing classes; other = golf, fitness, cooking classes, anything else)
- price: Price string (e.g., "$30", "Free") or null
- artists: Array of performer names, or null
- event_url: Direct link to event/tickets if mentioned, else null

Rules:
- Only extract events with specific dates. Ignore vague mentions ("events coming soon").
- If a post describes a date range (e.g., "July 17 – August 2"), create ONE entry with the start date and note the full date range in the description.
- If no events are found, return an empty array.
- Use ${year} for dates unless the post clearly states a different year.
- Default venue_name to "${ctx.defaultVenue}" if no specific venue is mentioned.

Return a JSON array only, no other text.

Page title: ${title}
Page URL: ${url}
Page content:
${content}`;

  const message = await client.messages.create({
    // Sonnet, not Haiku: this is full free-text extraction of venue / address /
    // dates from unstructured pages (BLS flyers, Facebook, generic sources).
    // It's the highest-stakes call in the pipeline — a wrong venue/address here
    // ships straight to the map — so accuracy beats the per-call cost savings.
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    // Accuracy first: extraction must never invent facts. The voice constitution
    // governs ONLY how the free-text `description` field is phrased.
    system: withVoice(
      "You extract events from a venue's page into JSON. Accuracy is paramount: never invent or alter facts (dates, prices, venues, performers). The voice rules below govern ONLY how you phrase the free-text `description` field; keep descriptions plain and specific, and if the source copy already reads well, preserve it rather than rewriting.",
    ),
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    const decoded = (parsed as ExtractedEvent[]).map(decodeEventFields);
    // Post-extraction venue detection: resolve generic venue names
    for (const event of decoded) {
      if (applyVenueDetection(event)) {
        console.log(`  Venue detected: "${event.venue_name}" from "${event.name}"`);
      }
    }
    return decoded;
  } catch {
    console.warn(`Failed to parse LLM response for "${title}":`, text.slice(0, 200));
    return [];
  }
}
