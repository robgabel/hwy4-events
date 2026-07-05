import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskPriority } from "../tasks";
import { generateEventSlug } from "../slugs";

// QA agent (PRD-roadmap-board.md Phase 3). A sibling to /api/check-events, but where
// that audit reports DATA issues to Slack, this one HTTP-checks the live SITE for
// CODE/regression bugs (a page erroring, missing JSON-LD, a broken sitemap) and files
// `type='bug'` `proposed` tickets onto the Roadmap board. Advisory only — a human
// promotes each one, same gate as every cockpit proposal.
//
// Deterministic checks (no LLM): cheap, and a hit is an unambiguous "this is broken."
// One ticket per check-class (deduped by a stable check_key stored in ai_rationale)
// so a recurring failure never floods the board.

export type QaKind = "page" | "event" | "sitemap";

// A page target. keyScope makes the dedup key stable: static routes key by path;
// sampled dynamic routes (event/town, whose slugs rotate) key by a class label so
// "event detail pages missing JSON-LD" is ONE ticket, not one per sampled slug.
export type QaTarget = { path: string; kind: QaKind; keyScope: string; label: string };

export type QaFinding = { check: string; severity: TaskPriority; detail: string };

const SEV_LABEL: Record<string, { title: string; severity: TaskPriority }> = {
  status: { title: "returns an error", severity: "p1" },
  malformed: { title: "is malformed", severity: "p1" },
  jsonld: { title: "is missing JSON-LD structured data", severity: "p2" },
  title: { title: "is missing a <title>", severity: "p2" },
};

// PURE: given a fetched page, what's wrong with it. Locked by scripts/test/qa-audit.test.ts.
export function checkPage(kind: QaKind, status: number, body: string): QaFinding[] {
  // A non-200 is the whole story — don't also flag missing content on an error page.
  if (status !== 200) {
    return [{ check: "status", severity: "p1", detail: `returned HTTP ${status || "connection error"}` }];
  }
  const findings: QaFinding[] = [];
  if (kind === "sitemap") {
    if (!/<(urlset|sitemapindex)\b/i.test(body)) {
      findings.push({ check: "malformed", severity: "p1", detail: "response is not a valid sitemap XML document" });
    }
    return findings;
  }
  // page + event both need a non-empty <title>. Inspect the tag's actual content
  // (a naive "\S after <title>" would treat "<title></title>" as non-empty, since
  // the "<" of the closing tag is non-whitespace).
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || titleMatch[1].trim().length === 0) {
    findings.push({ check: "title", severity: "p2", detail: "no non-empty <title> element in the HTML" });
  }
  // event detail pages must carry JSON-LD (the AEO/structured-data spine).
  if (kind === "event" && !body.includes("application/ld+json")) {
    findings.push({ check: "jsonld", severity: "p2", detail: "no application/ld+json script on the event page" });
  }
  return findings;
}

export function checkKey(check: string, keyScope: string): string {
  return `qa:${check}:${keyScope}`;
}

function ticketTitle(check: string, label: string): string {
  const t = SEV_LABEL[check]?.title ?? `has a ${check} issue`;
  return `QA: ${label} ${t}`;
}

async function fetchTarget(base: string, path: string): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}${path}`, {
      signal: controller.signal,
      headers: { "User-Agent": "Hwy4EventsQA/1.0" },
      cache: "no-store",
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch {
    return { status: 0, body: "" }; // network error / timeout → treated as a status finding
  } finally {
    clearTimeout(timer);
  }
}

// The static route set: the money pages + the funnel + the sitemaps.
const STATIC_TARGETS: QaTarget[] = [
  { path: "/", kind: "page", keyScope: "/", label: "The homepage" },
  { path: "/this-week", kind: "page", keyScope: "/this-week", label: "The /this-week page" },
  { path: "/this-weekend", kind: "page", keyScope: "/this-weekend", label: "The /this-weekend page" },
  { path: "/this-month", kind: "page", keyScope: "/this-month", label: "The /this-month page" },
  { path: "/things-to-do", kind: "page", keyScope: "/things-to-do", label: "The /things-to-do page" },
  { path: "/free", kind: "page", keyScope: "/free", label: "The /free page" },
  { path: "/date-night", kind: "page", keyScope: "/date-night", label: "The /date-night page" },
  { path: "/about", kind: "page", keyScope: "/about", label: "The /about page" },
  { path: "/submit", kind: "page", keyScope: "/submit", label: "The /submit page" },
  { path: "/sitemap.xml", kind: "sitemap", keyScope: "/sitemap.xml", label: "The sitemap index" },
  { path: "/sitemap-core.xml", kind: "sitemap", keyScope: "/sitemap-core.xml", label: "The core sitemap" },
  { path: "/sitemap-events.xml", kind: "sitemap", keyScope: "/sitemap-events.xml", label: "The events sitemap" },
];

export type QaAuditResult = {
  checked: number;
  findings: number;
  filed: number;
  skipped: number;
  filed_titles: string[];
};

// Build the dynamic sample: a few live event-detail pages + a few town pages. Slugs
// rotate, so these key by class (event-detail / town-page), not by slug.
async function dynamicTargets(supabase: SupabaseClient): Promise<QaTarget[]> {
  const today = new Date().toISOString().split("T")[0];
  const targets: QaTarget[] = [];

  // Event-detail URLs are COMPUTED from name+date+town (there is no `slug` column —
  // the app builds them via generateEventSlug, mirrored here). Exclude is_routine
  // rows: those 404 on the detail page by design, so sampling one would be a false bug.
  const { data: events, error } = await supabase
    .from("hwy4_events")
    .select("name, date, town")
    .gte("date", today)
    .eq("visibility", "public")
    .neq("status", "cancelled")
    .neq("is_routine", true)
    .order("date", { ascending: true })
    .limit(3);
  if (error) console.error("[qa-audit] event sample query failed:", error.message);
  for (const e of (events ?? []) as { name: string; date: string; town: string }[]) {
    targets.push({
      path: `/events/${generateEventSlug(e.name, e.date, e.town)}`,
      kind: "event",
      keyScope: "event-detail",
      label: "Event detail pages",
    });
  }

  // A small, stable set of town pages (town slugs don't rotate like event slugs).
  for (const slug of ["arnold", "murphys", "angels-camp"]) {
    targets.push({ path: `/towns/${slug}`, kind: "page", keyScope: "town-page", label: "Town pages" });
  }
  return targets;
}

export async function runQaAudit(supabase: SupabaseClient, baseUrl: string): Promise<QaAuditResult> {
  const targets = [...STATIC_TARGETS, ...(await dynamicTargets(supabase))];

  // Fetch + evaluate all targets in parallel.
  const perTarget = await Promise.all(
    targets.map(async (t) => {
      const res = await fetchTarget(baseUrl, t.path);
      return { target: t, findings: checkPage(t.kind, res.status, res.body), status: res.status };
    })
  );

  // Collapse to one entry per check_key, collecting example paths (dedup a class
  // that fails on multiple sampled slugs into a single ticket).
  type Agg = { key: string; check: string; severity: TaskPriority; title: string; examples: string[]; detail: string };
  const byKey = new Map<string, Agg>();
  for (const { target, findings } of perTarget) {
    for (const f of findings) {
      const key = checkKey(f.check, target.keyScope);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.examples.includes(target.path)) existing.examples.push(target.path);
      } else {
        byKey.set(key, {
          key,
          check: f.check,
          severity: f.severity,
          title: ticketTitle(f.check, target.label),
          examples: [target.path],
          detail: f.detail,
        });
      }
    }
  }
  const aggs = [...byKey.values()];

  // Dedup against QA tickets already open, or dismissed in the last 30 days (don't
  // re-nag a declined one). We DO refile something that was previously done and has
  // regressed, so `done` is deliberately not in this set.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [openRows, dismissedRows] = await Promise.all([
    supabase
      .from("hwy4_tasks")
      .select("ai_rationale")
      .eq("source", "qa_agent")
      .in("status", ["proposed", "backlog", "ready", "in_progress", "in_review"]),
    supabase
      .from("hwy4_tasks")
      .select("ai_rationale")
      .eq("source", "qa_agent")
      .eq("status", "wont_do")
      .gte("updated_at", cutoff),
  ]);
  const seenKeys = new Set(
    [...((openRows.data ?? []) as { ai_rationale: { check_key?: string } | null }[]),
     ...((dismissedRows.data ?? []) as { ai_rationale: { check_key?: string } | null }[])]
      .map((r) => r.ai_rationale?.check_key)
      .filter((k): k is string => Boolean(k))
  );

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const a of aggs) {
    if (seenKeys.has(a.key)) {
      skipped++;
      continue;
    }
    const examples = a.examples.slice(0, 5).join(", ");
    rows.push({
      title: a.title,
      body: `The QA audit found a problem on the live site: ${a.detail}.\n\nAffected: ${examples}.\n\nReproduce by loading the URL(s) above and confirming, then fix the underlying page/route. (Filed automatically by the QA agent; if it is a false alarm or already fixed, Dismiss it.)`,
      type: "bug",
      priority: a.severity,
      status: "proposed",
      source: "qa_agent",
      created_by: "qa_agent",
      ai_rationale: { check_key: a.key, rationale: `${a.detail} (${examples})`, examples: a.examples },
    });
  }

  let filed = 0;
  if (rows.length > 0) {
    const { error, count } = await supabase.from("hwy4_tasks").insert(rows, { count: "exact" });
    if (error) {
      console.error("[qa-audit] insert failed:", error.message);
    } else {
      filed = count ?? rows.length;
    }
  }

  return {
    checked: targets.length,
    findings: aggs.length,
    filed,
    skipped: skipped + (rows.length - filed),
    filed_titles: rows.slice(0, filed || rows.length).map((r) => String(r.title)),
  };
}
