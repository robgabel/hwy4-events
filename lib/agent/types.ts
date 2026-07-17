// Shared shape for the chief-of-staff digest. Produced by
// /api/agent/chief-of-staff and rendered by /admin/today, so the shape lives
// in one place and cannot drift. Stage 0 (read-only) — see PRD-agent-cockpit.md.

export type DigestItem = {
  title: string;
  detail: string;
  why?: string; // only on needs_you items: what's at stake if it's ignored
  link?: string; // optional internal admin path, e.g. "/admin/verification"
};

export type Digest = {
  summary: string; // 1-2 plain sentences. No em dashes.
  needs_you: DigestItem[]; // genuinely needs a human decision today
  fyi: DigestItem[]; // ran-fine confirmations + minor notes
  watching: DigestItem[]; // trends worth tracking, not acting on (SEO, etc.)
};

export type Vitals = {
  upcoming_events_14d: number;
  needs_verification: number;
  pending_submissions: number;
  merges_24h: number;
  seo_rows: number;
  // Days until the homepage Rob's Picks section goes empty (null = empty now).
  // Optional because agent_runs rows persisted before 2026-07-05 lack it.
  picks_runway_days?: number | null;
  // Standing data-quality backlog from the daily /api/check-events audit
  // (issue counts + actionable link gaps; null = no audit summary found).
  // Optional because agent_runs rows persisted before 2026-07-11 lack it.
  audit_backlog?: number | null;
};

// Exactly what the reasoner is handed, and what we persist as context_in.
// The model may ONLY summarize what's in here — this is the ground truth.
export type DigestContext = {
  date: string;
  vitals: Vitals;
  needs_verification_sample: {
    name: string;
    date: string;
    venue: string;
    town: string;
    reason: string | null;
  }[];
  pending_submissions_sample: {
    name: string;
    date: string;
    town: string;
    submitter: string | null;
    submitted: string;
    // Agent triage verdict for this submission, if it has been analyzed.
    verdict: string | null; // publish_new | duplicate | duplicate_needs_update | reject
    confidence: string | null;
    headline: string | null;
  }[];
  seo: {
    captured_at: string | null;
    top: { query: string; clicks: number; impressions: number; position: number }[];
  };
  // Rob's Picks runway (lib/agent/picks-runway.ts). robs_pick is hand-curated,
  // so the digest warns before the homepage picks module quietly goes empty.
  picks?: import("./picks-runway").PicksRunway;
  // Yesterday's data-quality audit (lib/agent/audit-signal.ts), read back from
  // site_config so the digest can never say "all quiet" while the audit's own
  // Slack post lists open items. null = no summary persisted yet.
  audit?: import("./audit-signal").AuditSignal | null;
};

export function emptyDigest(summary: string): Digest {
  return { summary, needs_you: [], fyi: [], watching: [] };
}

// ─────────────────────────────────────────────────────────────────────────
// Growth memo (PRD-growth-agent.md). The weekly Head-of-Growth reasoner. Same
// agent_runs plumbing as the daily digest, different lens: optimize for the
// North Star (Weekly Returning Residents, proxied by weekly local sessions),
// the newsletter, and the organizer network — and DRAFT the one move worth
// making this week. Read-only: it proposes and writes copy, a human sends.
// ─────────────────────────────────────────────────────────────────────────

// An optional drafted artifact attached to the move of the week. Phase 1 just
// renders it with a copy button; outward sends stay a human click (the cockpit
// rule that outward actions never auto-run).
export type GrowthDraft = {
  kind: "email" | "post" | "subject" | "note";
  subject?: string; // for email/subject drafts
  body: string;
  to_hint?: string; // who/where this is for, e.g. "a Murphys rental manager"
};

export type GrowthMove = {
  title: string;
  detail: string;
  why: string; // the metric this moves and why it's the highest-leverage thing
  draft?: GrowthDraft;
};

export type GrowthDigest = {
  summary: string; // 1-2 plain sentences. No em dashes.
  north_star: { headline: string; detail: string }; // WRR proxy + newsletter trend, one honest read
  move_of_the_week: GrowthMove | null; // THE single highest-leverage move (null on a genuinely quiet week)
  experiments: DigestItem[]; // running tests + early reads (the agent's memory/scoreboard)
  watching: DigestItem[]; // leading signals, not yet actionable
  ops: DigestItem[]; // demoted: queue items that still genuinely need a human click
};

export type GrowthVitals = {
  newsletter_active: number;
  newsletter_net_7d: number; // new confirmed minus unsubscribes, last 7 days
  newsletter_confirm_rate_30d: number | null; // 0-1, the opt-in leak; null if no recent signups
  local_sessions_7d: number; // WRR proxy (distinct local view sessions, last 7d)
  local_sessions_prev_7d: number;
  business_referrals_7d: number; // outbound business clicks, last 7d
  pageviews_7d: number;
};

// A logged growth experiment (growth_experiments). The agent reads these as
// ground truth and reports an early read; it does not invent experiments.
export type GrowthExperimentRow = {
  name: string;
  hypothesis: string | null;
  metric: string | null;
  status: string; // running | won | lost | inconclusive | abandoned
  baseline: string | null;
  result: string | null;
  started_on: string;
  concluded_on: string | null;
};

export type GrowthContext = {
  date: string;
  vitals: GrowthVitals;
  experiments: GrowthExperimentRow[];
  // The agent's durable memory (HWY-5): distilled lessons it reads back each run,
  // and its own recent move_of_the_week so it can check whether last week landed.
  lessons: string[];
  prior_moves: { date: string; title: string }[];
  newsletter: {
    active: number;
    net_7d: number; // confirmed minus unsubscribed, last 7d
    net_30d: number;
    pending_unconfirmed: number; // signed up but never clicked confirm — the leak
    confirm_rate_30d: number | null;
    // Who the list is (R1c): active subscribers by visitor class at signup.
    by_class: { local: number; visitor: number; unknown: number };
    // Where signups came from (R1b): active subscribers by placement code.
    by_source: Record<string, number>;
    // Daily confirmed signups + running total, last ~30d (R1a). Trend, not buckets.
    daily: { date: string; signups: number; net: number; cumulative_active: number }[];
    last_send: {
      date: string | null;
      sent_count: number | null;
      clicks: number; // non-bot newsletter_clicks for that campaign
      top_events: { slug: string; clicks: number }[];
    };
  };
  audience: {
    // WRR is not directly knowable (no persistent visitor id, only session_id),
    // so these are honest proxies: weekly local engagement, labeled directional.
    local_sessions_7d: number;
    local_sessions_prev_7d: number;
    visitor_sessions_7d: number;
    engaged_local_sessions_7d: number; // local sessions with 2+ views (depth)
  };
  referrals: {
    total_7d: number;
    total_30d: number;
    by_type: Record<string, number>; // click_type -> count, last 30d
    visitor_share_30d: number | null; // fraction of referral clicks from visitors (the secondary North Star)
    top_events: { event_id: string; clicks: number }[];
  };
  channels: {
    // First-touch arrival channel (site_events.src): qr / share / host /
    // newsletter / ref:<host>, with "direct" for untagged. The acquisition view
    // the experiments need (e.g. host-kit = scans tagged src=host -> referrals).
    sessions_by_src_7d: Record<string, number>; // distinct view sessions by channel, last 7d
    referrals_by_src_30d: Record<string, number>; // business-referral clicks by channel, last 30d
  };
  traffic: {
    pageviews_7d: number;
    pageviews_prev_7d: number;
    top_pages: { key: string; pageviews: number }[];
    // Answer-engine referral visits summed over the last 14 days of
    // analytics_daily (NOT a single day — see gatherGrowthContext / HWY-4).
    ai_referrals: Record<string, number>;
  };
  seo: {
    captured_at: string | null;
    window: { start: string; end: string } | null; // GSC date range of the trend spine
    totals: { clicks: number; impressions: number; ctr: number; avg_position: number } | null; // last 28d
    mom: {
      clicks_delta_pct: number | null;
      impressions_delta_pct: number | null;
      position_delta: number | null; // negative = rank improved
    } | null;
    top: { query: string; clicks: number; impressions: number; position: number }[];
    // Highest-leverage SEO work: page-1/2 fringe queries a rank nudge would convert.
    striking: {
      query: string;
      clicks: number;
      impressions: number;
      position: number;
      potential: number; // un-captured impressions
    }[];
  };
  network: {
    durable_orgs: number; // hwy4_orgs with a canonical_url (organizers with a durable link)
    share_hits_7d: Record<string, number>; // src -> count, last 7d
    poster_pending: number;
  };
  ops: {
    pending_submissions: number;
    needs_verification: number;
  };
};

// Defensive coercion of model JSON into a GrowthDigest. Never throws; returns
// null if unusable so the caller can fall back to a degraded run.
export function coerceGrowthDigest(raw: unknown): GrowthDigest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.summary !== "string") return null;

  const items = (v: unknown): DigestItem[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
          .map((x) => ({
            title: String(x.title ?? "").slice(0, 200),
            detail: String(x.detail ?? "").slice(0, 600),
            why: x.why != null ? String(x.why).slice(0, 600) : undefined,
            link:
              typeof x.link === "string" && x.link.startsWith("/") ? x.link : undefined,
          }))
          .filter((x) => x.title || x.detail)
      : [];

  const ns = (o.north_star ?? {}) as Record<string, unknown>;

  let move: GrowthMove | null = null;
  if (o.move_of_the_week && typeof o.move_of_the_week === "object") {
    const m = o.move_of_the_week as Record<string, unknown>;
    if (m.title || m.detail) {
      let draft: GrowthDraft | undefined;
      if (m.draft && typeof m.draft === "object") {
        const d = m.draft as Record<string, unknown>;
        const kind = String(d.kind ?? "note");
        if (typeof d.body === "string" && d.body.trim()) {
          draft = {
            kind: (["email", "post", "subject", "note"].includes(kind)
              ? kind
              : "note") as GrowthDraft["kind"],
            subject: d.subject != null ? String(d.subject).slice(0, 200) : undefined,
            body: String(d.body).slice(0, 2000),
            to_hint: d.to_hint != null ? String(d.to_hint).slice(0, 200) : undefined,
          };
        }
      }
      move = {
        title: String(m.title ?? "").slice(0, 200),
        detail: String(m.detail ?? "").slice(0, 800),
        why: String(m.why ?? "").slice(0, 600),
        draft,
      };
    }
  }

  return {
    // Capped like every other text field. summary is the field the degraded
    // raw-JSON dump used to land in, and the only one that was unbounded; a
    // backstop here keeps a runaway run from blowing out the layout.
    summary: o.summary.slice(0, 600),
    north_star: {
      headline: String(ns.headline ?? "").slice(0, 200),
      detail: String(ns.detail ?? "").slice(0, 600),
    },
    move_of_the_week: move,
    experiments: items(o.experiments),
    watching: items(o.watching),
    ops: items(o.ops),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Scraper health memo (the operational-health cockpit tab). Weekly reasoner
// over `scrape_runs` (written by scripts/lib/scrape-run-log.ts on every
// scripts/scrape.ts run). Reuses the plain Digest/DigestItem shape above —
// needs_you = sources broken right now, fyi = notable finds / clean weeks,
// watching = flaky-but-not-broken sources worth eyeballing. Same agent_runs
// table as the other two reasoners, tagged run_type='scraper_health'.
// ─────────────────────────────────────────────────────────────────────────

export type ScraperHealthVitals = {
  windowDays: number;
  runsInWindow: number;
  cleanRuns: number;
  runsWithErrors: number;
  totalInserted: number;
  totalUpdated: number;
  currentlyErroringSources: number;
};

export type ScraperHealthContext = {
  date: string;
  vitals: ScraperHealthVitals;
  recentRuns: {
    date: string;
    status: "clean" | "errors" | "no-data";
    durationMs: number;
    sourcesAttempted: number;
    sourcesErrored: number;
    totalInserted: number;
    totalUpdated: number;
  }[];
  // Sources currently erroring (their most recent appearance was a failure).
  brokenSources: { key: string; lastError: string | null; lastErrorAt: string | null; errorRunsInWindow: number }[];
  // Sources that ran clean all window but never inserted/updated anything —
  // possibly a site that changed shape, or a genuinely quiet source.
  quietSources: { key: string; runsSeen: number }[];
};

// Defensive coercion of model JSON into a Digest. Never throws; returns null
// if the shape is unusable so the caller can fall back to a degraded run.
export function coerceDigest(raw: unknown): Digest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.summary !== "string") return null;

  const items = (v: unknown): DigestItem[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
          .map((x) => ({
            title: String(x.title ?? "").slice(0, 200),
            detail: String(x.detail ?? "").slice(0, 600),
            why: x.why != null ? String(x.why).slice(0, 600) : undefined,
            // only internal admin links are allowed through
            link:
              typeof x.link === "string" && x.link.startsWith("/") ? x.link : undefined,
          }))
          .filter((x) => x.title || x.detail)
      : [];

  return {
    summary: o.summary,
    needs_you: items(o.needs_you),
    fyi: items(o.fyi),
    watching: items(o.watching),
  };
}
