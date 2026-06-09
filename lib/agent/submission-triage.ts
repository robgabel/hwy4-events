// Agent Cockpit — submission triage (PRD-agent-cockpit.md, Stage 1 for submissions).
//
// Given a community-submitted event, form an expert opinion the human reviewer
// can act on at /admin/submissions:
//   1. DB check — does an event like this already exist? Reuses the SHARED
//      matcher (lib/event-identity.ts `isSameEvent` + `generateDedupKey`), the
//      same logic the scrapers and reconcile use, so the agent and the dedup
//      engine never disagree.
//   2. Web research — Anthropic's native web_search tool finds a canonical /
//      organizer page, confirms date/time/venue, and pulls anything the
//      submission is missing.
//   3. Verdict — publish as new, already a duplicate, duplicate-but-adds-new-info,
//      or reject, with a one-line headline + plain-prose why + suggested field
//      fills + sources.
//
// The agent NEVER writes to hwy4_events or publishes. It only stores its opinion
// on the submission row. A human always clicks Publish / Merge / Dismiss.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  isSameEvent,
  generateDedupKey,
  normalizeTown,
  type EventIdentity,
} from "@/lib/event-identity";
import type { EventCategory, EventCostTier } from "@/lib/types";

export const TRIAGE_MODEL = "claude-sonnet-4-6";

const CATEGORIES: EventCategory[] = [
  "live_music",
  "festival",
  "civic",
  "hike_walk",
  "kids",
  "wine",
  "games",
  "fine_arts",
  "other",
];
const COST_TIERS: EventCostTier[] = ["free", "paid", "donation", "varies", "unknown"];
const VERDICTS = ["publish_new", "duplicate", "duplicate_needs_update", "reject"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

export type TriageVerdict = (typeof VERDICTS)[number];
export type TriageConfidence = (typeof CONFIDENCES)[number];

export interface TriageSuggestedFields {
  venue_name?: string;
  start_time?: string; // HH:MM 24h
  end_time?: string; // HH:MM 24h
  category?: EventCategory;
  description?: string;
  event_url?: string;
  price?: string;
  cost_tier?: EventCostTier;
}

export interface TriageSource {
  title: string;
  url: string;
}

export interface TriageCandidate {
  id: string;
  name: string;
  date: string;
  strong_match: boolean;
  exact_dedup: boolean;
}

export interface TriageAnalysis {
  verdict: TriageVerdict;
  confidence: TriageConfidence;
  matched_event_id: string | null;
  headline: string;
  rationale: string;
  new_info: string | null; // duplicate_needs_update: what the submission/web adds
  canonical_url: string | null;
  sources: TriageSource[];
  suggested: TriageSuggestedFields;
  flags: string[];
  candidates_considered: TriageCandidate[];
}

// The submission shape the triage reads. Mirrors event_submissions columns.
export interface SubmissionForTriage {
  id: string;
  event_name: string;
  event_date: string;
  start_time: string | null;
  venue_name: string | null;
  town: string;
  description: string | null;
  category: string | null;
  event_url: string | null;
  status?: string;
  ai_analyzed_at?: string | null;
}

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key);
}

function submissionToIdentity(sub: SubmissionForTriage): EventIdentity {
  return {
    name: sub.event_name,
    date: sub.event_date,
    town: sub.town,
    venue_name: sub.venue_name,
    start_time: sub.start_time,
    end_time: null,
    description: sub.description,
    artists: null,
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

interface DbCandidateRow {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  town: string;
  description: string | null;
  artists: string[] | null;
  category: string | null;
  event_url: string | null;
  source_name: string | null;
  community_sourced: boolean | null;
  status: string | null;
  dedup_key: string | null;
}

// Same-town, within ±3 days of the submitted date (catches a one-day date typo).
// The corridor is small, so this is a handful of rows. We tag each with the
// deterministic signals: `strong_match` (the shared isSameEvent matcher already
// calls it the same event) and `exact_dedup` (identical normalized key).
async function findCandidates(
  supabase: SupabaseClient,
  sub: SubmissionForTriage
): Promise<{ rows: DbCandidateRow[]; tagged: TriageCandidate[]; exactId: string | null }> {
  const { data } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, date, start_time, end_time, venue_name, town, description, artists, category, event_url, source_name, community_sourced, status, dedup_key"
    )
    .gte("date", addDays(sub.event_date, -3))
    .lte("date", addDays(sub.event_date, 3))
    .neq("status", "cancelled");

  const all = (data as DbCandidateRow[] | null) ?? [];
  const subTown = normalizeTown(sub.town);
  const rows = all.filter((r) => normalizeTown(r.town) === subTown);

  const dedupKey = generateDedupKey(sub.event_name, sub.event_date, sub.town);
  const subIdentity = submissionToIdentity(sub);
  let exactId: string | null = null;

  const tagged: TriageCandidate[] = rows.map((r) => {
    const exact = !!r.dedup_key && r.dedup_key === dedupKey;
    if (exact && !exactId) exactId = r.id;
    return {
      id: r.id,
      name: r.name,
      date: r.date,
      strong_match: isSameEvent(subIdentity, {
        name: r.name,
        date: r.date,
        town: r.town,
        venue_name: r.venue_name,
        start_time: r.start_time,
        end_time: r.end_time,
        description: r.description,
        artists: r.artists,
      }),
      exact_dedup: exact,
    };
  });

  return { rows, tagged, exactId };
}

const SYSTEM_PROMPT = `You are the submissions analyst for Hwy4Events.com, a one-person community events site for the California Highway 4 corridor (Calaveras County: Angels Camp, Copperopolis, Murphys, Arnold, Avery, Camp Connell, Dorrington, White Pines, Bear Valley). A neighbor submitted an event through the public form. Your job is to give the site owner an expert, researched recommendation: should they publish it as new, is it already on the site, is it on the site but missing info this submission adds, or should they pass.

You are given the submission plus existing same-town database events within three days of the submitted date. Each candidate is tagged: strong_match=true means our own deterministic matcher already considers it the SAME event (trust that heavily); exact_dedup=true means identical normalized name+date+town. A candidate one day off with the same act/venue is very likely the same event with a date typo.

Use web_search (a few queries) to find a canonical or organizer page for THIS specific event: the venue's site, the organizer, a local news listing, an official Facebook event. Confirm the date, time, and venue, and pull a short factual description, the official event URL, and the admission price ONLY if explicitly stated. Never invent facts you did not find.

Decide ONE verdict:
- publish_new: not in the database, and it reads as a real corridor event worth listing.
- duplicate: already in the database and the submission adds nothing new. Set matched_event_id.
- duplicate_needs_update: already in the database, but the submission and/or your web research add information the existing row lacks (a real description where it had none, a confirmed start/end time, the official URL, the correct venue). Set matched_event_id and state exactly what is new in new_info.
- reject: outside the corridor, cannot be verified as a real event, looks like spam or a test, or is otherwise not a fit.

Fill "suggested" with values to complete the listing, drawn from the submission and your research: venue_name, start_time and end_time as HH:MM 24-hour, category (one of: live_music, festival, civic, hike_walk, kids, wine, games, fine_arts, other), a clean description, event_url, price as a short string, and cost_tier (one of: free, paid, donation, varies, unknown). Include only fields you are confident about. Omit the rest.

Rules:
- matched_event_id MUST be one of the provided candidate ids, or null. Never invent an id.
- If verdict is duplicate or duplicate_needs_update you MUST set matched_event_id.
- Voice for headline and rationale: plain, direct, a little dry, like a sharp operator briefing a peer. Short. No hype, no emojis, and NO EM DASHES (use commas, periods, or parentheses).
- The headline is one line the owner reads first (e.g. "New, legit: Arnold's annual car show, found the organizer page" or "Already on the site, no new info").

Output STRICT JSON only. No markdown fences, no preamble. Match this shape exactly:
{"verdict": string, "confidence": "high|medium|low", "matched_event_id": string|null, "headline": string, "rationale": string, "new_info": string|null, "canonical_url": string|null, "sources": [{"title": string, "url": string}], "suggested": {"venue_name"?: string, "start_time"?: string, "end_time"?: string, "category"?: string, "description"?: string, "event_url"?: string, "price"?: string, "cost_tier"?: string}, "flags": [string]}
Allowed flags: out_of_corridor, date_unconfirmed, possible_spam, past_event, web_unverified, members_only.`;

function buildUserMessage(
  sub: SubmissionForTriage,
  rows: DbCandidateRow[],
  tagged: TriageCandidate[]
): string {
  const tagById = new Map(tagged.map((t) => [t.id, t]));
  const candidates = rows.map((r) => ({
    id: r.id,
    name: r.name,
    date: r.date,
    start_time: r.start_time,
    end_time: r.end_time,
    venue_name: r.venue_name,
    town: r.town,
    description: r.description ? r.description.slice(0, 400) : null,
    category: r.category,
    event_url: r.event_url,
    source: r.source_name,
    community_sourced: !!r.community_sourced,
    strong_match: tagById.get(r.id)?.strong_match ?? false,
    exact_dedup: tagById.get(r.id)?.exact_dedup ?? false,
  }));

  const submission = {
    event_name: sub.event_name,
    event_date: sub.event_date,
    start_time: sub.start_time,
    venue_name: sub.venue_name,
    town: sub.town,
    category: sub.category,
    description: sub.description,
    event_url: sub.event_url,
  };

  return `SUBMISSION:\n${JSON.stringify(submission, null, 2)}\n\nEXISTING DATABASE CANDIDATES (same town, within 3 days):\n${
    candidates.length ? JSON.stringify(candidates, null, 2) : "(none)"
  }\n\nResearch and return the verdict JSON.`;
}

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

function str(v: unknown, max = 600): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

// Coerce the model JSON into a validated TriageAnalysis. Defensive: clamps enums,
// confines matched_event_id to the real candidate ids, and resolves inconsistent
// duplicate-without-a-match into the strongest available match (or downgrades).
function coerce(raw: unknown, tagged: TriageCandidate[]): TriageAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  let verdict = oneOf<TriageVerdict>(o.verdict, VERDICTS);
  if (!verdict) return null;
  const confidence = oneOf<TriageConfidence>(o.confidence, CONFIDENCES) ?? "low";

  const validIds = new Set(tagged.map((t) => t.id));
  let matched =
    typeof o.matched_event_id === "string" && validIds.has(o.matched_event_id)
      ? o.matched_event_id
      : null;

  // A duplicate verdict with no valid match: fall back to the strongest signal,
  // else downgrade to publish_new with a flag (don't assert a phantom dupe).
  const flags = Array.isArray(o.flags)
    ? o.flags.filter((f): f is string => typeof f === "string").slice(0, 8)
    : [];
  if ((verdict === "duplicate" || verdict === "duplicate_needs_update") && !matched) {
    const strong = tagged.find((t) => t.exact_dedup) ?? tagged.find((t) => t.strong_match);
    if (strong) {
      matched = strong.id;
    } else {
      verdict = "publish_new";
      flags.push("match_unresolved");
    }
  }

  const rawSuggested = (o.suggested && typeof o.suggested === "object" ? o.suggested : {}) as Record<
    string,
    unknown
  >;
  const suggested: TriageSuggestedFields = {};
  if (str(rawSuggested.venue_name, 200)) suggested.venue_name = str(rawSuggested.venue_name, 200);
  if (str(rawSuggested.start_time, 8)) suggested.start_time = str(rawSuggested.start_time, 8);
  if (str(rawSuggested.end_time, 8)) suggested.end_time = str(rawSuggested.end_time, 8);
  const cat = oneOf<EventCategory>(rawSuggested.category, CATEGORIES);
  if (cat) suggested.category = cat;
  if (str(rawSuggested.description, 2000)) suggested.description = str(rawSuggested.description, 2000);
  if (str(rawSuggested.event_url, 600)) suggested.event_url = str(rawSuggested.event_url, 600);
  if (str(rawSuggested.price, 120)) suggested.price = str(rawSuggested.price, 120);
  const tier = oneOf<EventCostTier>(rawSuggested.cost_tier, COST_TIERS);
  if (tier) suggested.cost_tier = tier;

  const sources: TriageSource[] = Array.isArray(o.sources)
    ? o.sources
        .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
        .map((s) => ({ title: str(s.title, 200), url: str(s.url, 600) }))
        .filter((s) => s.url)
        .slice(0, 8)
    : [];

  return {
    verdict,
    confidence,
    matched_event_id: matched,
    headline: str(o.headline, 220) || "Reviewed.",
    rationale: str(o.rationale, 1200),
    new_info: typeof o.new_info === "string" ? o.new_info.slice(0, 800) : null,
    canonical_url: typeof o.canonical_url === "string" ? o.canonical_url.slice(0, 600) : null,
    sources,
    suggested,
    flags,
    candidates_considered: tagged,
  };
}

// Run the model with web search and parse the verdict. Throws on hard failure.
export async function analyzeSubmission(
  supabase: SupabaseClient,
  sub: SubmissionForTriage
): Promise<{ analysis: TriageAnalysis; model: string }> {
  const { rows, tagged } = await findCandidates(supabase, sub);

  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    // web_search_20250305 is an Anthropic server tool, executed during the call;
    // no client tool loop needed (same pattern as scripts/enrich-venue-addresses.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as any],
    messages: [{ role: "user", content: buildUserMessage(sub, rows, tagged) }],
  });

  const text = message.content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.type === "text")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text)
    .join("\n");

  const analysis = coerce(safeJson(text), tagged);
  if (!analysis) {
    throw new Error(`Could not parse a verdict from the model. Raw: ${text.slice(0, 300)}`);
  }
  return { analysis, model: TRIAGE_MODEL };
}

async function persistAnalysis(
  supabase: SupabaseClient,
  id: string,
  analysis: TriageAnalysis,
  model: string
): Promise<void> {
  const { error } = await supabase
    .from("event_submissions")
    .update({
      ai_verdict: analysis.verdict,
      ai_confidence: analysis.confidence,
      ai_matched_event_id: analysis.matched_event_id,
      ai_headline: analysis.headline,
      ai_analysis: analysis,
      ai_model: model,
      ai_analyzed_at: new Date().toISOString(),
      ai_error: null,
    })
    .eq("id", id);
  if (error) throw error;
}

async function persistError(supabase: SupabaseClient, id: string, err: unknown): Promise<void> {
  await supabase
    .from("event_submissions")
    .update({
      ai_error: err instanceof Error ? err.message : String(err),
      ai_analyzed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

const TRIAGE_COLUMNS =
  "id, event_name, event_date, start_time, venue_name, town, description, category, event_url, status, ai_analyzed_at";

// Triage one submission by id. Skips already-analyzed rows unless force=true.
// Records a row-level error rather than throwing, so the on-submit hook and the
// cron backstop are both safe to call blindly.
export async function triageSubmissionById(
  id: string,
  opts: { force?: boolean } = {}
): Promise<{ ok: boolean; verdict?: TriageVerdict; skipped?: string; error?: string }> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("event_submissions")
    .select(TRIAGE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  const sub = data as SubmissionForTriage | null;
  if (!sub) return { ok: false, error: "Submission not found" };
  if (sub.status && sub.status !== "pending") return { ok: true, skipped: "not pending" };
  if (sub.ai_analyzed_at && !opts.force) return { ok: true, skipped: "already analyzed" };

  try {
    const { analysis, model } = await analyzeSubmission(supabase, sub);
    await persistAnalysis(supabase, id, analysis, model);
    return { ok: true, verdict: analysis.verdict };
  } catch (err) {
    console.error(`[submission-triage] ${id} failed:`, err);
    await persistError(supabase, id, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Cron backstop: triage all pending, un-analyzed submissions (newest first).
export async function triagePendingBatch(
  limit = 10
): Promise<{ processed: number; results: { id: string; verdict?: TriageVerdict; error?: string }[] }> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("event_submissions")
    .select("id")
    .eq("status", "pending")
    .is("ai_analyzed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const ids = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  const results: { id: string; verdict?: TriageVerdict; error?: string }[] = [];
  for (const id of ids) {
    const r = await triageSubmissionById(id);
    results.push({ id, verdict: r.verdict, error: r.error });
  }
  return { processed: ids.length, results };
}
