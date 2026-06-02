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
  }[];
  seo: {
    captured_at: string | null;
    top: { query: string; clicks: number; impressions: number; position: number }[];
  };
};

export function emptyDigest(summary: string): Digest {
  return { summary, needs_you: [], fyi: [], watching: [] };
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
