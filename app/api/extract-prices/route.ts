import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const maxDuration = 120;

// Scrapers frequently capture the fee in the description text (e.g. Brice
// Station's "Regular price $25.00") but never lift it into the structured
// `price`/`cost_tier` fields the UI renders. This route reads description+name
// and extracts ONLY an explicitly-stated fee — it never guesses an amount.
const EXTRACT_PROMPT = `You read a community event listing and extract its admission fee, if and only if one is explicitly stated.

Event:
- Name: {NAME}
- Venue: {VENUE}
- Description: {DESC}

Rules:
- Extract a fee ONLY if the text explicitly states one. NEVER infer, estimate, or invent a price. When in doubt, return "unknown".
- If the text says the event is free / no charge / free admission / no cover, return cost_tier "free" and price "Free".
- If a dollar amount is stated (e.g. "$25", "$25.00", "tickets $20", "Regular price $25.00"), return cost_tier "paid" and price as a clean string like "$25". If a range or "+" is shown (e.g. "$20-$35", "$62+"), keep it (price "$20-$35").
- If it's pay-what-you-can, pay-it-forward, donation-based, or suggested donation, return cost_tier "donation" and price "Pay what you can".
- If it's clearly ticketed/admission but the amount depends (tiers, "varies", "see website") with no single number, return cost_tier "varies" and price "Price varies".
- If there is NO fee information at all, return cost_tier "unknown" and price null. Do not assume free.

Return ONLY a JSON object, no markdown fences:
{
  "cost_tier": "free" | "paid" | "donation" | "varies" | "unknown",
  "price": "string" | null
}`;

type CostTier = "free" | "paid" | "donation" | "varies" | "unknown";

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  venue_name: string;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    return NextResponse.json({ error: "Missing env" }, { status: 500 });
  }

  // Allow a larger batch for manual backfill (?limit=150); default is sized to
  // stay within maxDuration on the daily cron.
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "40", 10) || 40, 1),
    150
  );

  const supabase = createClient(supabaseUrl, serviceKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Queue: upcoming events with no fee captured yet and not previously processed.
  // price_locked rows are human-set — never re-extract them (would re-lift a
  // stale amount out of the description, e.g. "$15 each" for Ironstone Mimosa
  // Sundays after the price changed).
  const { data: eventsRaw, error: evErr } = await supabase
    .from("hwy4_events")
    .select("id, name, description, venue_name")
    .is("price", null)
    .is("price_extracted_at", null)
    .eq("price_locked", false)
    .gte("date", todayISO())
    .order("date", { ascending: true })
    .limit(limit);
  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  const events = (eventsRaw ?? []) as EventRow[];
  if (events.length === 0) {
    return NextResponse.json({ processed: 0, message: "Queue empty — all upcoming events processed." });
  }

  const results: Array<{ id: string; cost_tier: CostTier; price: string | null }> = [];
  for (const ev of events) {
    const extractedAt = new Date().toISOString();

    // No description to read — mark processed so we don't re-queue it, leave unknown.
    if (!ev.description || ev.description.trim().length === 0) {
      await supabase
        .from("hwy4_events")
        .update({ price_extracted_at: extractedAt })
        .eq("id", ev.id);
      results.push({ id: ev.id, cost_tier: "unknown", price: null });
      continue;
    }

    const prompt = EXTRACT_PROMPT
      .replace("{NAME}", ev.name)
      .replace("{VENUE}", ev.venue_name)
      .replace("{DESC}", ev.description.slice(0, 4000));

    try {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      });
      const block = msg.content[0];
      if (block.type !== "text") throw new Error("non-text response");

      let json = block.text.trim();
      if (json.startsWith("```")) {
        json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(json) as { cost_tier: CostTier; price: string | null };
      const validTiers: CostTier[] = ["free", "paid", "donation", "varies", "unknown"];
      const tier: CostTier = validTiers.includes(parsed.cost_tier) ? parsed.cost_tier : "unknown";
      const price = tier === "unknown" ? null : (parsed.price ?? null);

      await supabase
        .from("hwy4_events")
        .update({
          cost_tier: tier,
          price,
          price_extracted_at: extractedAt,
        })
        .eq("id", ev.id);

      results.push({ id: ev.id, cost_tier: tier, price });
    } catch (err) {
      console.error(`[extract-prices] LLM/parse error for event ${ev.id}:`, err);
      // Leave price_extracted_at null so the next run retries this event.
    }
  }

  const tally = (t: CostTier) => results.filter((r) => r.cost_tier === t).length;
  return NextResponse.json({
    processed: results.length,
    queue_batch: events.length,
    free: tally("free"),
    paid: tally("paid"),
    donation: tally("donation"),
    varies: tally("varies"),
    unknown: tally("unknown"),
    results,
  });
}
