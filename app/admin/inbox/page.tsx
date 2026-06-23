import Link from "next/link";
import { getAdminClientOrNull } from "@/lib/admin/db";
import {
  INK,
  MUTED,
  SUBTLE,
  ACCENT,
  BORDER,
  CARD_BG,
  SUBTLE_BG,
  QueueShell,
  EmptyCard,
} from "@/components/admin/ui";

export const dynamic = "force-dynamic";

// The unified review queue — the single front door to everything that needs a
// human. The cockpit cleanup (Path C): instead of five separately-badged nav
// destinations (submissions, posters, verification, feedback, proposed actions),
// the agent fills ONE ranked list and the human disposes from here, drilling into
// each source's own page for the actual approve / reject / edit.
//
// Read-only by design: it ROUTES, it never writes. That's the crude-delete-first
// move — a shared dispose() handler that writes inline is a deliberate later step,
// not built until the per-source pages prove insufficient. Ranking is recency for
// now; stakes-weighted ordering is the next increment, on purpose.

type Kind = "submission" | "poster" | "verify" | "feedback" | "action";
type Tone = "ok" | "warn" | "bad" | "muted";

type InboxItem = {
  id: string;
  kind: Kind;
  chip: string; // left tag — defaults to the kind label, overridden for email subs
  title: string;
  summary: string | null;
  meta: string | null;
  when: string | null; // ISO — when it entered the queue
  href: string;
  badge: string | null; // optional status pill (e.g. a triage verdict)
  badgeTone: Tone;
};

const KIND: Record<Kind, { label: string; accent: string; href: string }> = {
  submission: { label: "Submission", accent: ACCENT, href: "/admin/submissions" },
  poster: { label: "Poster", accent: INK, href: "/admin/posters" },
  verify: { label: "Verify", accent: ACCENT, href: "/admin/verification" },
  feedback: { label: "Feedback", accent: INK, href: "/admin/feedback" },
  action: { label: "Action", accent: "#3730a3", href: "/admin/actions" },
};

// Triage verdict → human label + tone. Only submissions carry one.
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  publish_new: { label: "publish new", tone: "ok" },
  duplicate: { label: "duplicate", tone: "warn" },
  duplicate_needs_update: { label: "needs merge", tone: "warn" },
  reject: { label: "reject", tone: "bad" },
};

const TONE: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: "#eaf7ea", fg: "#1B3A2D" },
  warn: { bg: "#fff7ed", fg: "#92400e" },
  bad: { bg: "#fdecea", fg: "#922b21" },
  muted: { bg: "#f3f1ec", fg: SUBTLE },
};

function clip(s: string | null | undefined, n = 130): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type SubRow = {
  id: string;
  event_name: string | null;
  event_date: string | null;
  town: string | null;
  source: string | null;
  created_at: string;
  ai_verdict: string | null;
  ai_headline: string | null;
};
type PosterRow = {
  id: string;
  event_id: string | null;
  event_slug: string | null;
  submitter_name: string | null;
  created_at: string;
};
type VerifyRow = {
  id: string;
  name: string;
  date: string;
  town: string | null;
  verification_reason: string | null;
  verification_checked_at: string | null;
};
type FeedbackRow = {
  id: string;
  event_slug: string;
  event_name: string | null;
  note: string | null;
  submitter_role: string | null;
  created_at: string;
};
type ActionRow = {
  id: string;
  type: string;
  title: string | null;
  rationale: string | null;
  created_at: string;
};

async function loadInbox(): Promise<InboxItem[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];

  const [subs, posters, verifies, feedback, actions] = await Promise.all([
    supabase
      .from("event_submissions")
      .select("id, event_name, event_date, town, source, created_at, ai_verdict, ai_headline")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("poster_submissions")
      .select("id, event_id, event_slug, submitter_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("hwy4_events")
      .select("id, name, date, town, verification_reason, verification_checked_at")
      .eq("verification_status", "needs_verification")
      .order("verification_checked_at", { ascending: false }),
    supabase
      .from("event_feedback")
      .select("id, event_slug, event_name, note, submitter_role, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_actions")
      .select("id, type, title, rationale, created_at")
      .eq("status", "proposed")
      .order("created_at", { ascending: false }),
  ]);

  const items: InboxItem[] = [];

  // Submissions (community + email forwards).
  for (const s of (subs.data as SubRow[] | null) ?? []) {
    const v = s.ai_verdict ? VERDICT[s.ai_verdict] : null;
    items.push({
      id: `sub-${s.id}`,
      kind: "submission",
      chip: s.source === "email" ? "Email" : "Submission",
      title: s.event_name || "(untitled event)",
      summary: clip(s.ai_headline) ?? (s.ai_verdict ? null : "Awaiting triage"),
      meta: [s.event_date, s.town].filter(Boolean).join(" · ") || null,
      when: s.created_at,
      href: KIND.submission.href,
      badge: v ? v.label : s.ai_verdict ? s.ai_verdict : "needs triage",
      badgeTone: v ? v.tone : "muted",
    });
  }

  // Posters — resolve the event name from event_id.
  const posterRows = (posters.data as PosterRow[] | null) ?? [];
  const eventIds = [...new Set(posterRows.map((p) => p.event_id).filter(Boolean))] as string[];
  const eventName = new Map<string, string>();
  if (eventIds.length) {
    const { data } = await supabase.from("hwy4_events").select("id, name").in("id", eventIds);
    for (const e of (data as { id: string; name: string }[] | null) ?? []) eventName.set(e.id, e.name);
  }
  for (const p of posterRows) {
    const name = (p.event_id && eventName.get(p.event_id)) || p.event_slug || "Unknown event";
    items.push({
      id: `poster-${p.id}`,
      kind: "poster",
      chip: KIND.poster.label,
      title: name,
      summary: `New poster from ${p.submitter_name || "anonymous"}`,
      meta: null,
      when: p.created_at,
      href: KIND.poster.href,
      badge: null,
      badgeTone: "muted",
    });
  }

  // Verification — date didn't match the organizer's canonical page.
  for (const e of (verifies.data as VerifyRow[] | null) ?? []) {
    items.push({
      id: `verify-${e.id}`,
      kind: "verify",
      chip: KIND.verify.label,
      title: e.name,
      summary: clip(e.verification_reason) ?? "Date unconfirmed against the organizer's page",
      meta: [e.date, e.town].filter(Boolean).join(" · ") || null,
      when: e.verification_checked_at,
      href: KIND.verify.href,
      badge: "date unconfirmed",
      badgeTone: "warn",
    });
  }

  // Feedback — "Suggest a fix" corrections from event pages.
  for (const f of (feedback.data as FeedbackRow[] | null) ?? []) {
    const role = f.submitter_role === "organizer" ? "organizer" : f.submitter_role === "visitor" ? "visitor" : null;
    items.push({
      id: `fb-${f.id}`,
      kind: "feedback",
      chip: KIND.feedback.label,
      title: f.event_name || f.event_slug,
      summary: clip(f.note) ?? "(no note)",
      meta: role,
      when: f.created_at,
      href: KIND.feedback.href,
      badge: f.submitter_role === "organizer" ? "from organizer" : null,
      badgeTone: "ok",
    });
  }

  // Agent-proposed actions (Stage 1 — a human approves each).
  for (const a of (actions.data as ActionRow[] | null) ?? []) {
    items.push({
      id: `act-${a.id}`,
      kind: "action",
      chip: KIND.action.label,
      title: a.title || a.type,
      summary: clip(a.rationale) ?? `Agent proposes: ${a.type}`,
      meta: a.type,
      when: a.created_at,
      href: KIND.action.href,
      badge: "proposed",
      badgeTone: "muted",
    });
  }

  // Recency order (newest first). Stakes-weighted ranking is the next increment.
  items.sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""));
  return items;
}

export default async function InboxPage() {
  const items = await loadInbox();
  const counts = items.reduce<Record<Kind, number>>(
    (acc, it) => {
      acc[it.kind]++;
      return acc;
    },
    { submission: 0, poster: 0, verify: 0, feedback: 0, action: 0 }
  );

  return (
    <QueueShell
      title="Inbox"
      intro={
        <>
          Everything that needs you, in one place. The agent researches and pre-decides each item;
          you confirm. Tap a row to act on it. Newest first.
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyCard
          heading="Inbox zero."
          sub="Nothing needs you right now. New submissions, posters, flags, feedback, and agent proposals land here."
        />
      ) : (
        <>
          <CountStrip counts={counts} total={items.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((it) => (
              <Row key={it.id} item={it} />
            ))}
          </div>
        </>
      )}
    </QueueShell>
  );
}

function CountStrip({ counts, total }: { counts: Record<Kind, number>; total: number }) {
  const parts: { label: string; n: number; accent: string }[] = [
    { label: counts.submission === 1 ? "submission" : "submissions", n: counts.submission, accent: KIND.submission.accent },
    { label: counts.poster === 1 ? "poster" : "posters", n: counts.poster, accent: KIND.poster.accent },
    { label: "to verify", n: counts.verify, accent: KIND.verify.accent },
    { label: "feedback", n: counts.feedback, accent: KIND.feedback.accent },
    { label: counts.action === 1 ? "proposal" : "proposals", n: counts.action, accent: KIND.action.accent },
  ].filter((p) => p.n > 0);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "6px 14px",
        marginBottom: 18,
        color: MUTED,
        fontSize: 15,
      }}
    >
      <span style={{ color: INK, fontWeight: 700 }}>
        {total} item{total === 1 ? "" : "s"}
      </span>
      {parts.map((p) => (
        <span key={p.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.accent, display: "inline-block" }} />
          {p.n} {p.label}
        </span>
      ))}
    </div>
  );
}

function Row({ item }: { item: InboxItem }) {
  const accent = KIND[item.kind].accent;
  const tone = TONE[item.badgeTone];
  return (
    <Link
      href={item.href}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
        padding: "14px 16px",
        textDecoration: "none",
        color: INK,
      }}
    >
      {/* kind chip */}
      <span
        style={{
          flexShrink: 0,
          marginTop: 1,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: accent,
          background: SUBTLE_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          padding: "3px 8px",
          minWidth: 78,
          textAlign: "center",
        }}
      >
        {item.chip}
      </span>

      {/* body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: INK }}>{item.title}</span>
          {item.badge && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: tone.fg,
                background: tone.bg,
                borderRadius: 5,
                padding: "2px 7px",
              }}
            >
              {item.badge}
            </span>
          )}
        </div>
        {item.summary && (
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 14,
              lineHeight: 1.45,
              color: MUTED,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {item.summary}
          </p>
        )}
        {item.meta && (
          <p style={{ margin: "4px 0 0", fontSize: 13, color: SUBTLE }}>{item.meta}</p>
        )}
      </div>

      {/* age + affordance */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, color: SUBTLE, fontSize: 13 }}>
        <span>{ago(item.when)}</span>
        <span aria-hidden style={{ color: BORDER, fontSize: 18 }}>
          ›
        </span>
      </div>
    </Link>
  );
}
