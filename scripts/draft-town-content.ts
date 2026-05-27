/**
 * Draft a TownContent entry for a Hwy 4 town using Claude Opus.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/draft-town-content.ts murphys
 *
 * Inputs (all read at runtime from the repo, no API needed for context):
 *   - docs/LOCAL-KNOWLEDGE-BASE.md   (hyperlocal source-of-truth)
 *   - docs/PERSONAS.md               (target personas)
 *   - app/about/page.tsx             (voice reference)
 *
 * Output: a TypeScript TownContent literal printed to stdout. Paste into
 * `app/towns/town-content.ts` TOWN_CONTENT registry after Rob's review.
 *
 * Voice rules are enforced in the system prompt below. The model is told NOT
 * to invent facts. If LOCAL-KNOWLEDGE-BASE.md doesn't cover a town richly,
 * the draft will be sparse and the script will flag it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// --- args ---

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: tsx scripts/draft-town-content.ts <slug>");
  console.error("  e.g. tsx scripts/draft-town-content.ts murphys");
  console.error(
    "Valid slugs: angels-camp, arnold, avery, bear-valley, camp-connell, copperopolis, dorrington, murphys, white-pines"
  );
  process.exit(1);
}

// --- corridor metadata (mirrors lib/towns.ts; intentionally duplicated so the
// script has no Next.js / alias dependency) ---

const CORRIDOR = [
  { slug: "copperopolis", name: "Copperopolis", elevation: 850, tagline: "Copper country at the base" },
  { slug: "angels-camp", name: "Angels Camp", elevation: 1300, tagline: "Gold Rush gateway town" },
  { slug: "murphys", name: "Murphys", elevation: 2100, tagline: "Wine country in the pines" },
  { slug: "avery", name: "Avery", elevation: 2800, tagline: "Quiet stop on the way up" },
  { slug: "white-pines", name: "White Pines", elevation: 3500, tagline: "Just below Arnold" },
  { slug: "arnold", name: "Arnold", elevation: 4000, tagline: "Heart of the corridor" },
  { slug: "dorrington", name: "Dorrington", elevation: 4800, tagline: "Quiet mountain hamlet" },
  { slug: "camp-connell", name: "Camp Connell", elevation: 5000, tagline: "Deep in the pines" },
  { slug: "bear-valley", name: "Bear Valley", elevation: 7000, tagline: "Alpine resort at the summit" },
];

const town = CORRIDOR.find((t) => t.slug === slug);
if (!town) {
  console.error(`Unknown town slug: ${slug}`);
  console.error("Valid: " + CORRIDOR.map((t) => t.slug).join(", "));
  process.exit(1);
}

// --- load context files ---

const repoRoot = resolve(__dirname, "..");
const knowledgeBase = readFileSync(
  join(repoRoot, "docs/LOCAL-KNOWLEDGE-BASE.md"),
  "utf-8"
);
const personas = readFileSync(
  join(repoRoot, "docs/PERSONAS.md"),
  "utf-8"
);
const aboutPage = readFileSync(
  join(repoRoot, "app/about/page.tsx"),
  "utf-8"
);

// --- prompts ---

const SYSTEM_PROMPT = `You are writing in Rob Gabel's voice for Hwy 4 Events (hwy4events.com), a free community events guide Rob runs for the Highway 4 corridor in California's Sierra Nevada foothills.

Your job: produce TownContent JSON for a single town. Rob will review and edit before it ships. Optimize for being the most useful, most cite-able local source, both for humans and for AI search engines (Google AI Overviews, ChatGPT, Perplexity).

=== WHO ROB IS (calibrate the tone, don't quote any of this) ===

Stanford MBA. Former founder/CEO of Tubular Labs (venture-backed social video analytics). Currently Chief Strategy Officer at Spotter. Strategic operator, not a junior marketer. He's talking to neighbors and to other operators, not at consumers. Doesn't perform. Knows the corridor because he's lived in Arnold since 2015, not because he read a tourism brochure.

=== ROB'S VOICE (from system/SOUL.md, hard requirements) ===

NEVER USE EM DASHES (—). This is Rob's most-broken rule. Use commas, periods, semicolons, colons, or parentheses instead. If you find yourself reaching for a dash for an aside or interruption, restructure into two sentences.

EXAMPLES of em-dash rewrites (study these):
  Bad:  "Murphys is the wine country stop on the way up the 4 — fifteen minutes below Arnold."
  Good: "Murphys is the wine country stop on the way up the 4. Fifteen minutes below Arnold."

  Bad:  "The Watering Hole has 40 rotating taps and a creek-side patio with a fire pit — closed Wednesdays."
  Good: "The Watering Hole has 40 rotating taps and a creek-side patio with a fire pit. Closed Wednesdays."

  Bad:  "V Restaurant — Thursday through Sunday, reservations matter."
  Good: "V Restaurant. Thursday through Sunday, reservations matter."

Other Rob voice rules:
- SHORT PARAGRAPHS, 2-3 sentences max. Rob scans. Break long thoughts into multiple sentences with periods.
- Direct. No hedging stacks ("might possibly potentially"). No filler ("I'd be happy to", "Great question"). No throat-clearing intros ("in this article we'll explore").
- No AI connective tissue: "moreover", "furthermore", "it's worth noting that".
- Standard capitalization, not lowercase.
- Smart, lightly playful, slightly wry. No corporate fog. No marketing speak.
- First-person ("I" = Rob) where natural.
- Real opinions, defended. When a question has an answer, give it. "It depends" without a lean is useless.

=== HWY 4 EVENTS BRAND VOICE ===

Match the About page (read it in the user message): warm, neighbor-talking, slightly self-deprecating, specific. Like Rob explaining the town to someone who just moved up the hill.

REFERENCE REAL BUSINESSES, OWNERS, LANDMARKS, AND NAMED PLACES from the knowledge base. No generic descriptions. "Snowshoe Brewing's patio on a Tuesday" beats "a local brewery". If you don't have a real reference, say less rather than invent.

BANNED PHRASES (never use these or close variants):
- "discover", "explore", "your gateway to", "nestled in the heart of"
- "charming", "hidden gem", "something for everyone", "a slice of"
- "experience the magic", "step back in time", "embrace the"
- any line that could appear unchanged on another town's events website

FALSIFIABLE SPECIFICS over vibes. "The post office closes at 4:30 and there's no Sunday delivery" beats "the post office is friendly". "Snowplows hit Camp Connell first because the elevation matters" beats "winter requires preparation".

PERSONA-TARGETED. Each town should speak to at least one persona by lived situation, never by name. Examples:
- Gary (retiree): parking, walking distances, daytime events
- Mia (winery worker): late shifts ending, post-work spots, locals' watering holes
- Karen (Airbnb host): what guests should know, where to send them
- Miguel (day-tripper from the Bay): drive time, what makes the trip worth it
- Jen (BLS mom): kid-friendly venues, family events

DON'T INVENT FACTS. If the knowledge base is thin on a town, the page can be shorter. Sparse is fine, made-up is not.

DON'T TRUST CADENCE OR HOURS CLAIMS FROM THE KNOWLEDGE BASE WITHOUT HEDGING. Statements like "live music 7 days a week", "open every day", "Thursday Jazz Jam every week" are exactly the kind of thing that goes stale and gets quoted forever. If the knowledge base asserts a weekly cadence or specific hours for a venue, either:
  (a) reference the venue's website ("posted on theirsite.com") so the reader can verify, OR
  (b) hedge ("often", "most weeks", "they post a calendar"), OR
  (c) omit the cadence claim entirely.
NEVER write a concrete weekly cadence ("seven nights a week", "every Thursday at 7pm") unless the knowledge base has a [VERIFIED via site, DATE] note next to that specific fact. Rob caught me hallucinating "Murphys Irish Pub live music 7 nights a week" because the knowledge base said so. The pub is closed Mon-Tue. Don't repeat that failure.

HYPERLOCAL VOCABULARY from the knowledge base ("the 4", "going up the hill", "the snow line", "summer people", "BLS"). Don't define these. Assume the reader is local or wants to feel local.

=== OUTPUT FORMAT ===

Return ONLY a valid JSON object matching this TypeScript type. No markdown, no preamble, no commentary. Just the JSON.

interface TownContent {
  slug: string;            // exactly the slug given
  townName: string;        // exact CORRIDOR name
  metaTitle: string;       // <60 chars, includes town + "Events" + "Hwy 4"
  metaDescription: string; // 150-160 chars, action-oriented, hyperlocal
  h1: string;              // page H1, ~50-70 chars, can be question-form
  subhead: string;         // single line under H1
  introTeaser: string;     // 1-2 sentences, above-the-fold, ALWAYS visible. Highest AEO weight. Snippet engines often quote the first ~1500 chars. Pack named entities + falsifiable specifics into this sentence.
  intro: string[];         // 2-3 paragraphs, 300-500 words TOTAL across the array. Rendered inside a "Read more" toggle.
  personaNotes: string[];  // 3-6 "if you're..." bullets, persona-targeted
  worthKnowing: string[];  // 5-10 falsifiable local facts
  faqs: { question: string; answer: string }[]; // 3-5 town-specific Q&As, answers ≤ 60 words
  lastVerified: string;    // today's date YYYY-MM-DD
}

=== AEO DENSITY RULES (this is content meant to be cited by AI engines) ===

- DEFINITIVE FACTUAL SENTENCES an answer engine can lift verbatim. Vague is invisible. "Most tasting rooms are open Thursday through Sunday, $10 to $20 for a flight" beats "tasting rooms have varying hours and prices".
- NAMED ENTITIES over generic descriptors. Real venues, owners, streets, numbers, dates.
- Q&A entries: the question is the literal user query someone would type into Google. The first sentence of the answer fully resolves the question.
- NUMBERS, RANGES, PRICE BANDS where relevant. "Open Mic at 6pm" beats "evening open mic".
- One source of truth per claim. Don't contradict yourself across the intro vs. the FAQ.

=== THE CONFERENCE-DINNER GUT CHECK ===

Before you emit the JSON, read every sentence and ask: would Rob actually say this out loud to another operator at a conference dinner? If it sounds like a marketing intern wrote it, rewrite or cut.

=== FINAL CHECK BEFORE OUTPUT ===

Scan your draft for em dashes (—). If you find any, rewrite them out. This is a hard fail.

Scan for AI tells: "moreover", "furthermore", "it's worth noting", "discover", "explore", "your gateway to", "nestled", "charming", "hidden gem". Any hit is a rewrite, not a publish.`;

const today = new Date().toISOString().split("T")[0];

const USER_PROMPT = `Draft TownContent for ${town.name}, California (slug: ${town.slug}, elevation: ${town.elevation} ft, internal tagline: "${town.tagline}").

=== LOCAL KNOWLEDGE BASE (your primary source) ===
${knowledgeBase}

=== PERSONAS ===
${personas}

=== ABOUT PAGE (voice reference, match this tone) ===
${aboutPage}

=== INSTRUCTIONS ===
- Use today's date "${today}" for lastVerified.
- Pull from the LOCAL KNOWLEDGE BASE section specifically about ${town.name}. If the knowledge base says the town has thin coverage, write a shorter, honest page. Do NOT pad with generic content.
- Reference at least 3 named local businesses, landmarks, or community figures from the knowledge base.
- Make at least one persona note clearly map to a specific persona without naming them.
- Run the banned-phrase check against your own output before finalizing.

Output the JSON object now.`;

// --- call Opus ---

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY env var is required.");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.error(`Drafting ${town!.name} (this takes ~30-60s with Opus)...`);

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: USER_PROMPT }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // Strip code-fence guards if Opus adds them despite the prompt
  const cleaned = text
    .replace(/^```(?:json|typescript|ts)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Validate JSON shape
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse JSON output. Raw response:");
    console.error(text);
    process.exit(1);
  }

  // Sanity-check 1: em dashes (SOUL.md hard rule)
  const rawText = JSON.stringify(parsed);
  const emDashCount = (rawText.match(/—/g) || []).length;
  if (emDashCount > 0) {
    console.error(
      `\n⚠️  Draft contains ${emDashCount} em dash(es) (—). Rob's voice never uses em dashes.`
    );
    console.error("Rob: rewrite these with commas/periods/semicolons before committing.\n");
  }

  // Sanity-check 2: banned marketing phrases + AI tells
  const BANNED = [
    "discover",
    "explore",
    "your gateway",
    "nestled in",
    "charming",
    "hidden gem",
    "something for everyone",
    "experience the magic",
    "step back in time",
    "moreover",
    "furthermore",
    "it's worth noting",
    "in this article",
    "let's dive in",
  ];
  const lower = rawText.toLowerCase();
  const violations = BANNED.filter((b) => lower.includes(b));
  if (violations.length > 0) {
    console.error(
      `\n⚠️  Draft contains banned phrases: ${violations.join(", ")}`
    );
    console.error("Rob: edit these out before committing.\n");
  }

  // Pretty-print for paste-into-source
  console.log("\n// ---- Paste into TOWN_CONTENT in app/towns/town-content.ts ----\n");
  console.log(`"${slug}": ${JSON.stringify(parsed, null, 2)},`);
  console.log("\n// ----");
  console.error(
    `\nUsage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens`
  );
}

main().catch((err) => {
  console.error("Draft failed:", err);
  process.exit(1);
});
