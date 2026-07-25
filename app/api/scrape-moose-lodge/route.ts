import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireCronAuth, requireRegion } from "@/lib/cron-auth";
import { createHash } from "node:crypto";
import {
  classifyNotabilityDetailed,
  reconcileNotability,
} from "@/lib/notability";

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

// Convert a Google Drive share link (…/file/d/<id>/view) into a direct-download
// URL that fetch() can pull PDF bytes from. Pass-through for any other URL.
function normalizePdfUrl(url: string): string {
  const drive = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  return url;
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
  category: string;
  // True => a routine lodge operation (weekly dinner, "open for a holiday"),
  // hidden from the public site. The floor reconciles a whiffed LLM value.
  is_routine?: boolean;
}

const VALID_CATEGORIES = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "games",
  "fine_arts",
  "other",
] as const;

function normalizeCategory(hint: string | null | undefined): string {
  return hint && (VALID_CATEGORIES as readonly string[]).includes(hint)
    ? hint
    : "civic";
}

// ─── Composite-event filter ─────────────────────────────────────────────
//
// Defense-in-depth: even though the prompt forbids composite events
// ("Shuffle Board & Bingo"), the model occasionally emits them anyway.
// This filter runs after extraction and drops a composite event whenever
// the calendar also contains its atomic components on the same date.
//
// Example: input contains all three of
//   { name: "Shuffle Board",         date: "2026-05-27", start: "16:30" }
//   { name: "Bingo",                 date: "2026-05-27", start: "18:00" }
//   { name: "Shuffle Board & Bingo", date: "2026-05-27", start: "16:30" }
// Output drops the composite, keeps the two atomic events.
//
// If a composite appears WITHOUT its atomic components, we keep it
// (better an imperfect-but-real event than missing data). The model
// having to split it is a separate concern handled by the prompt.

function splitCompositeName(name: string): string[] {
  // Splits on " & ", " and " (case-insensitive), " + ", " / ".
  // Returns trimmed component names, lowercased, with empties removed.
  return name
    .split(/\s+(?:&|and|\+|\/)\s+/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

function isCompositeName(name: string): boolean {
  return splitCompositeName(name).length >= 2;
}

function filterCompositeDuplicates(events: ExtractedEvent[]): {
  kept: ExtractedEvent[];
  dropped: Array<{ name: string; date: string; reason: string }>;
} {
  // Build an index of atomic event names per date so we can detect when
  // a composite's components are already represented as separate rows.
  const atomicByDate = new Map<string, Set<string>>();
  for (const evt of events) {
    if (!evt.name || !evt.date || isCompositeName(evt.name)) continue;
    if (!atomicByDate.has(evt.date)) atomicByDate.set(evt.date, new Set());
    atomicByDate.get(evt.date)!.add(evt.name.trim().toLowerCase());
  }

  const kept: ExtractedEvent[] = [];
  const dropped: Array<{ name: string; date: string; reason: string }> = [];

  for (const evt of events) {
    if (!evt.name || !evt.date) {
      kept.push(evt); // Let the downstream validation catch this.
      continue;
    }
    if (!isCompositeName(evt.name)) {
      kept.push(evt);
      continue;
    }
    const components = splitCompositeName(evt.name);
    const atomicOnDate = atomicByDate.get(evt.date) ?? new Set();
    const allComponentsPresent = components.every((c) => atomicOnDate.has(c));

    if (allComponentsPresent) {
      dropped.push({
        name: evt.name,
        date: evt.date,
        reason: `composite shadows atomic events (${components.join(", ")})`,
      });
    } else {
      // Composite without atomic counterparts — keep it. Splitting
      // requires knowing the times of each part, which the prompt
      // failed to provide. Better to ship the composite than nothing.
      kept.push(evt);
    }
  }

  return { kept, dropped };
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
  "visibility": "public" or "private",
  "category": "live_music|festival|civic|hike_walk|kids|wine|games|other",
  "is_routine": true or false
}

CATEGORY (describe WHAT the event is, not where it happens):
- live_music: live bands, karaoke, DJ events (e.g. "Flashback", "Dinner & Karaoke")
- kids: kid-focused events (e.g. "Kids Easter Party")
- wine: wine tastings or wine-pairing events
- games: social/pub games (e.g. bingo, shuffle board, queen of hearts, cribbage, cards)
- civic: everything else at the lodge — dinners, breakfasts, meetings, workdays, crab feeds, holiday meals. This is the default.

VISIBILITY CLASSIFICATION:
- "public" = open to the general public, large community events, or matches the public events page below
- "private" = members-only: board / officer / chapter meetings, bingo, queen of hearts, regular weekly dinners, workdays, karaoke, moose legion meetings

IS_ROUTINE (is this a real event, or just the lodge doing its normal thing?):
- true = mundane, standing operations that aren't events: regular weekly/monthly dinners, breakfasts, brunches, "Prime Rib Night", "Taco Tuesday", deli/daily specials, and "open for [holiday]" meal service. Being open to serve a meal is NOT an event.
- false = a genuine event with a hook: live music / bands / karaoke, the car show, crab feeds, themed one-offs, guest performers, fundraisers with entertainment. A special dinner WITH live music is false (an event), even though it involves a meal.
- If unsure, use false.

Here is text from the lodge's PUBLIC events page (events listed here are confirmed public):
---
${publicContext}
---

RULES:
1. One JSON object per distinct activity. NEVER emit a composite event that joins two activities with "&", "and", "+", or "/" in the name when those activities happen at different times. If Shuffle Board is at 4:30pm and Bingo is at 6pm on the same day, you MUST emit two separate events: {"name": "Shuffle Board", "start_time": "16:30"} and {"name": "Bingo", "start_time": "18:00"}. Emitting {"name": "Shuffle Board & Bingo"} alongside the atomic events is a critical error that creates user-visible duplicates. If a single calendar cell contains multiple activities at different times, split them. One activity per object. No exceptions.
2. Exception: a Queen of Hearts drawing bundled with a dinner at the SAME time slot is ONE event (because they happen simultaneously, not sequentially).
3. SKIP empty days, "LODGE CLOSED", and "DINNER COOK NEEDED" placeholders with no actual event.
4. Include breakfast events ("BREAKFAST 9-11:30am") as their own events.
5. Use the calendar's month and year for all dates.
6. Events also listed on the public events page above → "public". Events marked "Open to the Public" → "public". Everything else → "private".
7. NEVER use em dashes (—) in any field. Rob's voice rules forbid them. Use commas, periods, semicolons, parentheses instead.

Return ONLY a valid JSON array. No markdown fences, no extra text.`;
}

// ─── Route handler ─────────────────────────────────────────────────────

export async function GET(request: Request) {

  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;
  // Calaveras-only scraper (Ebbetts Pass Moose Lodge); no-op on other regions.
  const skip = requireRegion("calaveras");
  if (skip) return skip;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }
  if (!anthropicKey) {
    return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  // Optional override: ?pdf_url=… points the pipeline at an off-site PDF (e.g.
  // the lodge's newsletter on Google Drive) when their /current-calendar page
  // still serves last month's PDF. A manual, one-off run — see the sweep guard
  // below (a partial/newsletter PDF must not delete real rows).
  const overridePdfUrl = new URL(request.url).searchParams.get("pdf_url");

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Resolve the PDF URL — an explicit override, else the current link on
    //    /current-calendar.
    let pdfUrl: string;
    if (overridePdfUrl) {
      pdfUrl = normalizePdfUrl(overridePdfUrl);
      console.log(`[scrape-moose-lodge] Override PDF URL: ${pdfUrl}`);
    } else {
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
      pdfUrl = pdfMatch[1];
      if (pdfUrl.startsWith("//")) pdfUrl = "https:" + pdfUrl;
      else if (pdfUrl.startsWith("/")) pdfUrl = "https://ebbettspassmoose.com" + pdfUrl;

      console.log(`[scrape-moose-lodge] PDF URL: ${pdfUrl}`);
    }

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

    // 5a. Drop composite events ("X & Y") whose atomic components ("X" and
    //     "Y") also appear on the same date. Defense against the model
    //     occasionally emitting both atomic and composite forms.
    const { kept: dedupedEvents, dropped: droppedComposites } =
      filterCompositeDuplicates(events);
    if (droppedComposites.length > 0) {
      console.log(
        `[scrape-moose-lodge] Dropped ${droppedComposites.length} composite duplicates:`,
        droppedComposites.map((d) => `${d.date} ${d.name}`).join(", ")
      );
    }

    // 5b. Filter to future events only
    const today = new Date().toISOString().split("T")[0];
    const futureEvents = dedupedEvents.filter((e) => e.date && e.date >= today);
    console.log(`[scrape-moose-lodge] ${futureEvents.length} future events`);

    // 6. Upsert by canonical SHA256 dedup_key
    const stats = {
      total: events.length,
      composites_dropped: droppedComposites.length,
      future: futureEvents.length,
      created: 0,
      updated: 0,
      swept: 0,
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

      // Notability: the deterministic floor reconciles a whiffed LLM verdict
      // (an authoritative floor beats the model; a soft one defers to it).
      const floor = classifyNotabilityDetailed(
        `${evt.name} ${evt.description ?? ""}`,
        { category: normalizeCategory(evt.category) },
      );
      const isRoutine = reconcileNotability(floor, evt.is_routine);

      const row = {
        name: evt.name.trim(),
        description: evt.description || null,
        date: evt.date,
        start_time: evt.start_time || null,
        end_time: evt.end_time || null,
        venue_name: LODGE.venue,
        town: LODGE.town,
        address: LODGE.address,
        category: normalizeCategory(evt.category),
        status: "confirmed" as const,
        price: evt.price || null,
        event_url: null,
        source_url: pdfUrl,
        source_name: "moose-lodge-calendar",
        visibility: vis,
        org_slug: LODGE.orgSlug,
        dedup_key: dedupKey,
        is_routine: isRoutine,
        routine_reason: isRoutine ? (floor.rule ?? "llm") : null,
        last_scraped_at: new Date().toISOString(),
        is_weekly: false,
        robs_pick: false,
      };

      // Upsert: existing dedup_key → update; otherwise insert
      const { data: existing } = await supabase
        .from("hwy4_events")
        .select("id, notability_locked, times_locked")
        .eq("dedup_key", dedupKey)
        .maybeSingle();

      if (existing) {
        // This route writes its own UPDATE rather than going through
        // scripts/lib/dedup.ts `upsertEvents`, so it has to honor the human
        // locks itself. Drop each locked field from the payload.
        const updateRow: Partial<typeof row> = { ...row };
        if (existing.notability_locked) {
          delete updateRow.is_routine;
          delete updateRow.routine_reason;
        }
        if (existing.times_locked) {
          delete updateRow.start_time;
          delete updateRow.end_time;
        }
        const { error } = await supabase
          .from("hwy4_events")
          .update(updateRow)
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

    // 7. Stale-row sweep. Any future Moose Lodge events that did not get a
    //    fresh last_scraped_at in this run (or any earlier run within the
    //    grace window) are no longer on the lodge's published calendar.
    //    Delete them so the public site doesn't carry ghost events.
    //
    //    Grace: 14 days = 2 weekly scrapes worth of buffer, so a single
    //    transient LLM extraction failure does not delete real events.
    //    Past events are preserved as historical record.
    //
    //    SKIPPED on an override run (?pdf_url=…): that PDF may be a partial or
    //    newsletter document, so absence of a row in it does not mean the event
    //    was cancelled. A manual override is purely additive.
    let swept: Array<{ id: string; name: string; date: string; last_scraped_at: string | null }> | null = null;
    if (overridePdfUrl) {
      console.log("[scrape-moose-lodge] Override run — skipping stale sweep");
    } else {
      const STALE_GRACE_DAYS = 14;
      const staleCutoff = new Date(
        Date.now() - STALE_GRACE_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const todayDate = new Date().toISOString().split("T")[0];

      const { data: sweptRows, error: sweepErr } = await supabase
        .from("hwy4_events")
        .delete()
        .eq("org_slug", LODGE.orgSlug)
        .gte("date", todayDate)
        .or(`last_scraped_at.is.null,last_scraped_at.lt.${staleCutoff}`)
        .select("id, name, date, last_scraped_at");

      if (sweepErr) {
        console.error("[scrape-moose-lodge] Stale sweep failed:", sweepErr);
        errors.push({ name: "(sweep)", reason: sweepErr.message });
        stats.errors++;
      } else {
        swept = sweptRows;
        stats.swept = swept?.length ?? 0;
        if (stats.swept > 0) {
          console.log(
            `[scrape-moose-lodge] Swept ${stats.swept} stale rows:`,
            swept?.map((r) => `${r.date} ${r.name}`).join(", ")
          );
        }
      }
    }

    console.log("[scrape-moose-lodge] Complete:", stats);

    return NextResponse.json({
      ok: true,
      pdf_url: pdfUrl,
      stats,
      ...(droppedComposites.length > 0 && { droppedComposites }),
      ...(swept && swept.length > 0 && { swept }),
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
