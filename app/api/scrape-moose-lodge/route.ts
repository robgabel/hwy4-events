import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

/**
 * Scrape the Ebbetts Pass Moose Lodge monthly calendar PDF and upsert events
 * into hwy4_events.
 *
 * Replaces the deprecated `scrape-moose-lodge` Supabase edge function (2026-05-26)
 * which used an incompatible `evt_${java-hash}_${date}` dedup format and caused
 * duplicates against the canonical SHA256 hex format from scripts/lib/dedup.ts.
 *
 * This route:
 *   1. Auths against CRON_SECRET so only Vercel cron / Rob can hit it.
 *   2. Fetches https://ebbettspassmoose.com/current-calendar, greps the PDF link.
 *   3. Downloads the PDF as base64.
 *   4. Pulls /events page text as public/private classification context.
 *   5. Sends PDF + prompt to Claude for extraction.
 *   6. Upserts each event with the canonical SHA256 hex dedup key.
 *
 * Runs weekly via vercel.json — monthly PDFs change infrequently but
 * weekly catches updates within a few days.
 */

export const maxDuration = 120; // Vision/PDF document API can be slow

const LODGE = {
  venue: "Ebbetts Pass Moose Lodge",
  town: "Arnold",
  orgSlug: "moose-lodge",
  address: "3049 CA-4, Arnold, CA 95223",
  calendarUrl: "https://ebbettspassmoose.com/current-calendar",
  eventsUrl: "https://ebbettspassmoose.com/events",
};

// ─── Canonical dedup-key generator ─────────────────────────────────────
//
// MUST match scripts/lib/dedup.ts::generateDedupKey so this scraper's
// inserts are deduped against any other ingestion path. If you change one,
// change the other. The format is sha256(normalizeName | date | normalizeTown)
// truncated to 32 hex chars.

const TOWN_ALIASES: Record<string, string> = {
  "white pines": "arnold",
  "hathaway pines": "arnold",
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^the\s+/, "")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"');
}

function normalizeTown(town: string): string {
  const lower = town.toLowerCase().trim();
  return TOWN_ALIASES[lower] ?? lower;
}

function generateDedupKey(name: string, date: string, town: string): string {
  const input = `${normalizeName(name)}|${date}|${normalizeTown(town)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

// ─── Helpers ───────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

interface ExtractedEvent {
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  price: string | null;
  visibility: "public" | "private";
}

function buildPrompt(publicContext: string): string {
  return `You are parsing a monthly calendar PDF from Ebbetts Pass Moose Lodge #1123 in Arnold, California.

Extract every distinct event into a JSON array. Each object:
{
  "name": "Clean Event Name (title case)",
  "date": "YYYY-MM-DD",
  "start_time": "HH:MM" (24h format) or null,
  "end_time": "HH:MM" (24h format) or null,
  "description": "Brief details (menu, cooking crew, special notes). No em dashes — use commas, periods, or semicolons.",
  "price": "$XX" or null,
  "visibility": "public" or "private"
}

VISIBILITY CLASSIFICATION:
- "public" = open to the general public, large community events, or matches the public events page below
- "private" = members-only: board / officer / chapter meetings, bingo, queen of hearts, regular weekly dinners, workdays, karaoke, moose legion meetings

Here is text from the lodge's PUBLIC events page (events listed here are confirmed public):
---
${publicContext}
---

RULES:
1. One JSON object per distinct activity. A single day can have multiple events (e.g., a meeting at 4pm AND dinner at 6pm = two objects). PREFER SPLIT events over combined ones: if Shuffle Board is at 4:30pm and Bingo is at 6pm on the same day, emit two separate events ("Shuffle Board" at 16:30 and "Bingo" at 18:00), NOT a single combined "Shuffle Board & Bingo".
2. Exception: when a Queen of Hearts drawing is bundled with a dinner at the same time slot, treat as ONE event.
3. SKIP empty days, "LODGE CLOSED", and "DINNER COOK NEEDED" placeholders with no actual event.
4. Include breakfast events ("BREAKFAST 9-11:30am") as their own events.
5. Use the calendar's month and year for all dates.
6. Events also listed on the public events page above → "public". Events marked "Open to the Public" → "public". Everything else → "private".
7. NEVER use em dashes (—) in any field. Rob's voice rules forbid them. Use commas, periods, semicolons, parentheses instead.

Return ONLY a valid JSON array. No markdown fences, no extra text.`;
}

// ─── Route handler ─────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  if (!anthropicKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Find the current PDF link on /current-calendar
    const calPage = await fetch(LODGE.calendarUrl);
    if (!calPage.ok) {
      return NextResponse.json(
        { error: `Calendar page returned ${calPage.status}` },
        { status: 502 }
      );
    }
    const calHtml = await calPage.text();

    const pdfMatch =
      calHtml.match(/href=["']((?:https?:)?\/\/[^"']*?\.pdf)["']/i) ||
      calHtml.match(/href=["']([^"']*?\.pdf)["']/i);
    if (!pdfMatch) {
      return NextResponse.json(
        { error: "No PDF link found on /current-calendar page" },
        { status: 404 }
      );
    }
    let pdfUrl = pdfMatch[1];
    if (pdfUrl.startsWith("//")) pdfUrl = "https:" + pdfUrl;
    else if (pdfUrl.startsWith("/")) pdfUrl = "https://ebbettspassmoose.com" + pdfUrl;

    console.log(`[scrape-moose-lodge] PDF URL: ${pdfUrl}`);

    // 2. Download PDF as base64
    const pdfResp = await fetch(pdfUrl);
    if (!pdfResp.ok) {
      return NextResponse.json(
        { error: `PDF download returned ${pdfResp.status}` },
        { status: 502 }
      );
    }
    const pdfBytes = new Uint8Array(await pdfResp.arrayBuffer());
    const pdfB64 = toBase64(pdfBytes);
    console.log(`[scrape-moose-lodge] PDF downloaded: ${pdfBytes.length} bytes`);

    // 3. Fetch /events page text for public/private classification context
    let publicContext = "(unable to fetch public events page)";
    try {
      const evResp = await fetch(LODGE.eventsUrl);
      if (evResp.ok) {
        publicContext = stripHtml(await evResp.text()).slice(0, 3000);
      }
    } catch {
      // non-fatal
    }

    // 4. Claude extraction
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfB64 },
            },
            { type: "text", text: buildPrompt(publicContext) },
          ],
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      return NextResponse.json({ error: "Claude returned non-text content" }, { status: 502 });
    }
    let rawJson = block.text.trim();
    if (rawJson.startsWith("```")) {
      rawJson = rawJson.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let events: ExtractedEvent[];
    try {
      events = JSON.parse(rawJson);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse Claude response as JSON", preview: rawJson.slice(0, 500) },
        { status: 500 }
      );
    }
    console.log(`[scrape-moose-lodge] Extracted ${events.length} events`);

    // 5. Filter to future events only
    const today = new Date().toISOString().split("T")[0];
    const futureEvents = events.filter((e) => e.date && e.date >= today);
    console.log(`[scrape-moose-lodge] ${futureEvents.length} future events`);

    // 6. Upsert by canonical SHA256 dedup_key
    const stats = {
      total: events.length,
      future: futureEvents.length,
      created: 0,
      updated: 0,
      errors: 0,
      public_count: 0,
      private_count: 0,
    };
    const errors: Array<{ name: string; reason: string }> = [];

    for (const evt of futureEvents) {
      if (!evt.name || !evt.date) {
        errors.push({ name: evt.name || "?", reason: "missing name or date" });
        stats.errors++;
        continue;
      }

      const vis = evt.visibility === "public" ? "public" : "private";
      if (vis === "public") stats.public_count++;
      else stats.private_count++;

      const dedupKey = generateDedupKey(evt.name, evt.date, LODGE.town);

      const row = {
        name: evt.name.trim(),
        description: evt.description || null,
        date: evt.date,
        start_time: evt.start_time || null,
        end_time: evt.end_time || null,
        venue_name: LODGE.venue,
        town: LODGE.town,
        address: LODGE.address,
        category: "lodge" as const,
        status: "confirmed" as const,
        price: evt.price || null,
        event_url: null,
        source_url: pdfUrl,
        source_name: "moose-lodge-calendar",
        visibility: vis,
        org_slug: LODGE.orgSlug,
        dedup_key: dedupKey,
        last_scraped_at: new Date().toISOString(),
        is_weekly: false,
        robs_pick: false,
      };

      // Upsert: existing dedup_key → update; otherwise insert
      const { data: existing } = await supabase
        .from("hwy4_events")
        .select("id")
        .eq("dedup_key", dedupKey)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("hwy4_events")
          .update(row)
          .eq("id", existing.id);
        if (error) {
          errors.push({ name: evt.name, reason: `update: ${error.message}` });
          stats.errors++;
        } else {
          stats.updated++;
        }
      } else {
        const { error } = await supabase.from("hwy4_events").insert(row);
        if (error) {
          if (error.message.includes("duplicate")) {
            // Race condition with another concurrent scrape, treat as updated
            stats.updated++;
          } else {
            errors.push({ name: evt.name, reason: `insert: ${error.message}` });
            stats.errors++;
          }
        } else {
          stats.created++;
        }
      }
    }

    console.log("[scrape-moose-lodge] Complete:", stats);

    return NextResponse.json({
      ok: true,
      pdf_url: pdfUrl,
      stats,
      ...(errors.length > 0 && { errors }),
    });
  } catch (err) {
    console.error("[scrape-moose-lodge] Scraper failed:", err);
    return NextResponse.json(
      { error: "Scraper failed", details: String(err) },
      { status: 500 }
    );
  }
}
