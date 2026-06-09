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
  newsletter: {
    active: number;
    new_confirmed_7d: number;
    new_confirmed_prev_7d: number;
    unsub_7d: number;
    pending_unconfirmed: number; // signed up but never clicked confirm — the leak
    confirm_rate_30d: number | null;
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
  traffic: {
    pageviews_7d: number;
    pageviews_prev_7d: number;
    top_pages: { key: string; pageviews: number }[];
    ai_referrals: Record<string, number>;
  };
  seo: {
    captured_at: string | null;
    top: { query: string; clicks: number; impressions: number; position: number }[];
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

export function emptyGrowthDigest(summary: string): GrowthDigest {
  return {
    summary,
    north_star: { headline: "", detail: "" },
    move_of_the_week: null,
    experiments: [],
    watching: [],
    ops: [],
  };
}

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
    summary: o.summary,
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
