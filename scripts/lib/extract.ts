import Anthropic from "@anthropic-ai/sdk";

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
}

const client = new Anthropic();

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
- category: One of: live_music, festival, civic, resort, other
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
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed as ExtractedEvent[];
  } catch {
    console.warn(`Failed to parse LLM response for "${title}":`, text.slice(0, 200));
    return [];
  }
}
