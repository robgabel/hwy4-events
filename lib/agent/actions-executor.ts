import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentActionRow } from "@/lib/agent/policy";
import {
  lockColumnsFor,
  lockedViolations,
  validateQaFixPayload,
  type QaFixEventPayload,
} from "@/lib/agent/qa-fix-event";

// The action executor (PRD-agent-cockpit.md, Stage 1). Performs the same write a
// human would do by hand, AFTER capturing before_snapshot for reversibility. The
// caller (the /admin/actions approve server action) gates on the policy guardrail,
// then writes the returned target_* / before_snapshot back onto the agent_actions
// row. Every action type here is internal + reversible.

export type ExecuteResult = {
  ok: boolean;
  targetTable?: string;
  targetId?: string;
  beforeSnapshot?: Record<string, unknown> | null;
  error?: string;
};

export type CreateOrgRowPayload = {
  slug?: string;
  display_name?: string;
  canonical_url?: string;
  match_patterns?: string[];
  town?: string;
};

export type CreateVenueRowPayload = {
  venue_key?: string;
  canonical?: string;
  town?: string;
  address?: string;
  aliases?: string[];
};

export async function executeAction(
  supabase: SupabaseClient,
  action: AgentActionRow
): Promise<ExecuteResult> {
  switch (action.type) {
    case "create_org_row":
      return execCreateOrgRow(supabase, action.payload as CreateOrgRowPayload);
    case "create_venue_row":
      return execCreateVenueRow(supabase, action.payload as CreateVenueRowPayload);
    case "flag_spam_submission":
      return execFlagSpam(supabase, action.payload as { submission_id?: string });
    case "qa_fix_event":
      return execQaFixEvent(supabase, action.payload as QaFixEventPayload);
    default:
      return { ok: false, error: `Unknown action type: ${action.type}` };
  }
}

// Reverse an executed action. create_org_row deletes the inserted org (creating
// an org row never mutates events — orgs match events by match_patterns at
// resolve time — so the delete can't orphan anything). flag_spam restores the
// submission's pre-flag status from before_snapshot.
export async function revertAction(
  supabase: SupabaseClient,
  action: AgentActionRow
): Promise<{ ok: boolean; error?: string }> {
  if (!action.target_id) return { ok: false, error: "Nothing to revert (no target recorded)." };
  switch (action.type) {
    case "create_org_row": {
      const { error } = await supabase.from("hwy4_orgs").delete().eq("id", action.target_id);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    case "create_venue_row": {
      // target_id is the venue_key (hwy4_venues has no surrogate id). Deleting the
      // row can't orphan events: their venue_key links by registry resolution, not
      // a FK, and with "row + snippet only" the executor never wrote event keys.
      const { error } = await supabase.from("hwy4_venues").delete().eq("venue_key", action.target_id);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    case "flag_spam_submission": {
      const snap = (action.before_snapshot ?? {}) as { status?: string; review_note?: string | null };
      const { error } = await supabase
        .from("event_submissions")
        .update({
          status: snap.status ?? "pending",
          review_note: snap.review_note ?? null,
          reviewed_at: null,
        })
        .eq("id", action.target_id);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    case "qa_fix_event": {
      // before_snapshot holds exactly the columns the fix touched — writing it
      // back restores the pre-fix values without disturbing anything else.
      const snap = action.before_snapshot ?? null;
      if (!snap || Object.keys(snap).length === 0) {
        return { ok: false, error: "No before_snapshot recorded — cannot revert." };
      }
      const { error } = await supabase
        .from("hwy4_events")
        .update(snap)
        .eq("id", action.target_id);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    default:
      return { ok: false, error: `Cannot revert unknown type: ${action.type}` };
  }
}

// Apply a persona-QA field fix to one hwy4_events row (lib/agent/qa-fix-event.ts
// owns the column whitelist + lock rules). Snapshot-first so revert is exact.
async function execQaFixEvent(
  supabase: SupabaseClient,
  p: QaFixEventPayload
): Promise<ExecuteResult> {
  const v = validateQaFixPayload(p);
  if (!v.ok) return { ok: false, error: v.error };

  const selectCols = ["id", ...v.columns, ...lockColumnsFor(v.columns)].join(", ");
  const { data: before, error: readError } = await supabase
    .from("hwy4_events")
    .select(selectCols)
    .eq("id", v.eventId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!before) return { ok: false, error: `Event ${v.eventId} not found.` };

  const row = before as unknown as Record<string, unknown>;
  const locked = lockedViolations(row, v.columns);
  if (locked.length) {
    return {
      ok: false,
      error: `Field(s) human-locked, fix by hand instead: ${locked.join(", ")}.`,
    };
  }

  const { error } = await supabase.from("hwy4_events").update(v.updates).eq("id", v.eventId);
  if (error) return { ok: false, error: error.message };

  // Snapshot only the touched columns (not the lock flags — revert must not
  // write them back).
  const beforeSnapshot: Record<string, unknown> = {};
  for (const c of v.columns) beforeSnapshot[c] = row[c] ?? null;

  return { ok: true, targetTable: "hwy4_events", targetId: v.eventId, beforeSnapshot };
}

async function execCreateOrgRow(
  supabase: SupabaseClient,
  p: CreateOrgRowPayload
): Promise<ExecuteResult> {
  const slug = (p.slug ?? "").trim();
  const display_name = (p.display_name ?? "").trim();
  const canonical_url = (p.canonical_url ?? "").trim();
  if (!slug) return { ok: false, error: "Missing slug." };
  if (!display_name) return { ok: false, error: "Missing display name." };
  if (!canonical_url) {
    return { ok: false, error: "Missing canonical URL — research the organizer's events page and fill it in first." };
  }

  // Friendlier than surfacing a raw 23505 unique-violation.
  const { data: existing } = await supabase
    .from("hwy4_orgs")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return { ok: false, error: `An org with slug "${slug}" already exists.` };

  const row: Record<string, unknown> = {
    slug,
    display_name,
    canonical_url,
    // Leave canonical_check_enabled false: a durable LINK works without it, but
    // date-verification needs a server-rendered page, which we haven't confirmed.
    // The curator can flip it on later for a server-renderable events page.
    town: p.town?.trim() || null,
    notes: "Created from a cockpit create_org_row proposal (link-gap drain).",
  };
  const patterns = (p.match_patterns ?? []).map((s) => s.trim()).filter(Boolean);
  if (patterns.length) row.match_patterns = patterns;

  const { data: inserted, error } = await supabase
    .from("hwy4_orgs")
    .insert(row)
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "Insert returned no row." };

  // Insert: nothing to restore on revert beyond deleting target_id.
  return { ok: true, targetTable: "hwy4_orgs", targetId: inserted.id as string, beforeSnapshot: null };
}

// Register a venue: insert the hwy4_venues row so the event detail page has a
// venue section to render and /api/sync-venue-facts (weekly) auto-populates the
// Google facts (places_synced_at starts NULL → it's picked up). This is the
// "row + snippet only" half of Phase 1A: the row is the immediately-writable,
// reversible part; the human commits the emitted scripts/lib/venues.ts snippet to
// link the venue's events durably (the matcher is registry-driven; the scraper
// re-nulls an unregistered venue's key on re-scrape, so the registry edit is what
// makes the link permanent). address is Tier A but optional here — name + town
// still resolve a Places listing and a town-centroid map degrades gracefully.
async function execCreateVenueRow(
  supabase: SupabaseClient,
  p: CreateVenueRowPayload
): Promise<ExecuteResult> {
  const venue_key = (p.venue_key ?? "").trim();
  const canonical = (p.canonical ?? "").trim();
  const town = (p.town ?? "").trim();
  const address = (p.address ?? "").trim();
  if (!venue_key) return { ok: false, error: "Missing venue key." };
  if (!canonical) return { ok: false, error: "Missing canonical (display) name." };
  if (!town) return { ok: false, error: "Missing town." };

  // Friendlier than a raw 23505 unique-violation.
  const { data: existing } = await supabase
    .from("hwy4_venues")
    .select("venue_key")
    .eq("venue_key", venue_key)
    .maybeSingle();
  if (existing) return { ok: false, error: `A venue with key "${venue_key}" already exists.` };

  const { error } = await supabase.from("hwy4_venues").insert({
    venue_key,
    canonical,
    town,
    address: address || null,
    // places_synced_at left NULL so the next sync-venue-facts run enriches it.
  });
  if (error) return { ok: false, error: error.message };

  // hwy4_venues is keyed by venue_key (no surrogate id) — that's the revert handle.
  return { ok: true, targetTable: "hwy4_venues", targetId: venue_key, beforeSnapshot: null };
}

async function execFlagSpam(
  supabase: SupabaseClient,
  p: { submission_id?: string }
): Promise<ExecuteResult> {
  const id = (p.submission_id ?? "").trim();
  if (!id) return { ok: false, error: "Missing submission_id." };

  const { data: before } = await supabase
    .from("event_submissions")
    .select("status, review_note")
    .eq("id", id)
    .maybeSingle();
  if (!before) return { ok: false, error: "Submission not found." };

  const { error } = await supabase
    .from("event_submissions")
    .update({
      status: "rejected",
      review_note: "Flagged as spam via the cockpit.",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    targetTable: "event_submissions",
    targetId: id,
    beforeSnapshot: before as Record<string, unknown>,
  };
}
