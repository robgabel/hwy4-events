/**
 * Web-search enrichment for venue addresses.
 *
 * Finds candidate venues from the database that aren't in KNOWN_VENUES
 * (or are in KNOWN_VENUES but missing an address), then asks Claude to
 * web-search for the street address. Results are written to a JSON
 * staging file so a human (or scripts/promote-venue-addresses.ts) can
 * review before merging into venues.ts.
 *
 * Why a staging file: web searches sometimes hallucinate or return
 * out-of-corridor addresses. The matching step also has a corridor
 * sanity-check, but a manual review gate is the safer default for now.
 *
 * Usage:
 *   npx tsx enrich-venue-addresses.ts                 # all candidates
 *   npx tsx enrich-venue-addresses.ts --limit 10      # process N
 *   npx tsx enrich-venue-addresses.ts --venue "Name"  # one venue
 *   npx tsx enrich-venue-addresses.ts --include-registered-only
 */
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { KNOWN_VENUES } from "./lib/venues.js";
import fs from "node:fs";
import path from "node:path";

const STAGING_FILE = path.join(import.meta.dirname ?? ".", "venue-addresses-staged.json");

const HWY4_TOWNS = [
  "Copperopolis", "Angels Camp", "Murphys", "Avery", "White Pines",
  "Arnold", "Dorrington", "Camp Connell", "Bear Valley",
];

interface Candidate {
  source: "registry-missing-address" | "db-unknown-venue";
  venue_name: string;
  town: string | null;
  event_count: number;
  sample_event: string;
}

interface StagedResult {
  source: string;
  venue_name: string;
  town: string | null;
  event_count: number;
  proposed_address: string | null;
  validates: boolean;
  rationale: string;
}

const client = new Anthropic();

async function findCandidates(): Promise<Candidate[]> {
  const aliasSet = new Set<string>();
  const canonSet = new Set<string>();
  for (const v of Object.values(KNOWN_VENUES)) {
    canonSet.add(v.canonical.toLowerCase().trim());
    for (const a of v.aliases) aliasSet.add(a);
  }

  const out: Candidate[] = [];

  // Registered venues missing an address
  for (const v of Object.values(KNOWN_VENUES)) {
    if (!v.address) {
      out.push({
        source: "registry-missing-address",
        venue_name: v.canonical,
        town: v.town,
        event_count: 0,
        sample_event: "(registered venue, no address yet)",
      });
    }
  }

  // Unknown venues observed in future events
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("name, town, venue_name")
    .gte("date", today);
  if (error) throw new Error(`DB query failed: ${error.message}`);

  const seen = new Map<string, Candidate>();
  for (const row of (data ?? []) as Array<{ name: string; town: string; venue_name: string | null }>) {
    const venueName = (row.venue_name ?? "").trim();
    if (!venueName || venueName === "Unknown Venue") continue;
    const lower = venueName.toLowerCase();
    if (canonSet.has(lower) || aliasSet.has(lower)) continue;
    // Skip junk patterns the matcher already treats as generic
    if (/^(featuring|hosted by|with|feat\.?|w\/|@|the )/.test(lower)) continue;

    if (seen.has(lower)) {
      seen.get(lower)!.event_count++;
    } else {
      seen.set(lower, {
        source: "db-unknown-venue",
        venue_name: venueName,
        town: row.town ?? null,
        event_count: 1,
        sample_event: row.name,
      });
    }
  }

  // Highest event count first — we'd rather burn searches on the venues
  // showing up the most.
  return [...out, ...[...seen.values()].sort((a, b) => b.event_count - a.event_count)];
}

const ADDRESS_RE = /\b\d{1,6}[A-Z]?\s+[A-Za-z][^,\n]{2,80},\s*[A-Za-z][A-Za-z\s.'-]+,\s*CA\s+\d{5}/;

function corridorTownInAddress(addr: string): string | null {
  const lower = addr.toLowerCase();
  for (const t of HWY4_TOWNS) {
    if (lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

async function searchOne(venue: Candidate): Promise<{ address: string | null; rationale: string }> {
  const townHint = venue.town ? ` in or near ${venue.town}, California` : ", California";
  const prompt = `Find the official street address of the venue "${venue.venue_name}"${townHint}.

Context: this is a local venue along California Highway 4 in Calaveras County
(corridor towns: ${HWY4_TOWNS.join(", ")}). We use the address to drop a pin on a map.

Use web_search to find an authoritative source (the venue's own website,
Google Maps, Yelp, or a local directory). Do not guess.

Respond with ONLY a single JSON object — no prose, no markdown fences:
{
  "address": "<full street address in 'Street, City, ST ZIP' format>" | null,
  "rationale": "<one sentence: which source, or why you couldn't confirm>"
}

If you cannot find an address with high confidence, return null for address.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 } as any],
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b.type === "text")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text)
      .join("\n");

    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { address: null, rationale: `No JSON in response: ${text.slice(0, 200)}` };
    const parsed = JSON.parse(m[0]) as { address?: string | null; rationale?: string };
    return {
      address: parsed.address?.trim() ?? null,
      rationale: parsed.rationale?.trim() ?? "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { address: null, rationale: `Error: ${msg}` };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1] ?? "0", 10) : 0;
  const venueArg = args.indexOf("--venue");
  const onlyVenue = venueArg >= 0 ? args[venueArg + 1] : null;
  const registeredOnly = args.includes("--include-registered-only");

  console.log("=== enrich-venue-addresses ===");
  let candidates = await findCandidates();
  if (registeredOnly) {
    candidates = candidates.filter((c) => c.source === "registry-missing-address");
  }
  if (onlyVenue) {
    candidates = candidates.filter(
      (c) => c.venue_name.toLowerCase() === onlyVenue.toLowerCase()
    );
  }
  if (limit > 0) {
    candidates = candidates.slice(0, limit);
  }
  console.log(`Processing ${candidates.length} candidate(s)`);

  // Load previously staged so we don't re-search venues we already have.
  let prior: StagedResult[] = [];
  if (fs.existsSync(STAGING_FILE)) {
    try {
      prior = JSON.parse(fs.readFileSync(STAGING_FILE, "utf8"));
    } catch {
      prior = [];
    }
  }
  const priorMap = new Map(
    prior.map((p) => [`${p.venue_name.toLowerCase()}|${p.town ?? ""}`, p])
  );

  const staged: StagedResult[] = [];

  for (const c of candidates) {
    const key = `${c.venue_name.toLowerCase()}|${c.town ?? ""}`;
    const cached = priorMap.get(key);
    if (cached && cached.proposed_address) {
      console.log(`  · "${c.venue_name}" — cached: ${cached.proposed_address}`);
      staged.push(cached);
      continue;
    }

    console.log(`\nSearching: "${c.venue_name}" (${c.town ?? "?"}, ${c.event_count} events)`);
    const { address, rationale } = await searchOne(c);
    const validates =
      !!address && ADDRESS_RE.test(address) && !!corridorTownInAddress(address);

    if (address) {
      console.log(`  ${validates ? "✓" : "?"} ${address}`);
    } else {
      console.log(`  ✕ no address — ${rationale}`);
    }

    staged.push({
      source: c.source,
      venue_name: c.venue_name,
      town: c.town,
      event_count: c.event_count,
      proposed_address: address,
      validates,
      rationale,
    });

    // Persist after each search so a crash doesn't lose work.
    fs.writeFileSync(STAGING_FILE, JSON.stringify(staged, null, 2));
    // Lightweight rate-limit
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log("\n=== Summary ===");
  console.log(`Total processed:        ${staged.length}`);
  console.log(`  Auto-validates:       ${staged.filter((s) => s.validates).length}`);
  console.log(`  Returned-but-invalid: ${staged.filter((s) => s.proposed_address && !s.validates).length}`);
  console.log(`  No address found:     ${staged.filter((s) => !s.proposed_address).length}`);
  console.log(`Wrote ${STAGING_FILE}`);
  console.log(`\nReview the file, then run promote-venue-addresses.ts to merge.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
