import { createClient } from "@supabase/supabase-js";
import { TOWNS, CATEGORY_LABELS, type EventCategory } from "@/lib/types";
import { classifyEventCategory } from "@/lib/categorize";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL } from "@/lib/constants";
import {
  publishSubmission,
  dismissSubmission,
  mergeSubmission,
  reanalyzeSubmission,
  draftQuestionReply,
  draftReplyForReviewed,
} from "./actions";
import { gmailComposeUrl, type SubmissionReply } from "@/lib/agent/submission-reply";

export const dynamic = "force-dynamic";
// The "Re-analyze" server action runs web search + the model inline; give its
// route segment room beyond the default function timeout.
export const maxDuration = 60;

type Suggested = {
  venue_name?: string;
  start_time?: string;
  end_time?: string;
  category?: string;
  description?: string;
  event_url?: string;
  price?: string;
  cost_tier?: string;
};

type Analysis = {
  verdict: string;
  confidence: string;
  matched_event_id: string | null;
  headline: string;
  rationale: string;
  new_info: string | null;
  canonical_url: string | null;
  sources: { title: string; url: string }[];
  suggested: Suggested;
  flags: string[];
};

type Submission = {
  id: string;
  event_name: string;
  event_date: string;
  start_time: string | null;
  venue_name: string | null;
  town: string | null;
  description: string | null;
  category: string | null;
  event_url: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  created_at: string;
  ai_verdict: string | null;
  ai_confidence: string | null;
  ai_headline: string | null;
  ai_matched_event_id: string | null;
  ai_analysis: Analysis | null;
  ai_analyzed_at: string | null;
  ai_error: string | null;
  ai_reply: SubmissionReply | null;
};

type MatchedEvent = { id: string; name: string; date: string; town: string };

// The submission a just-completed action drafted a reply for (?replied=<id>).
// Fetched separately because once published/dismissed it leaves the pending list.
type RepliedSubmission = {
  event_name: string;
  submitter_name: string | null;
  ai_reply: SubmissionReply | null;
};

// A decided submission shown in the persistent "Recently reviewed" list, so the
// drafted reply (and the path to email the submitter) is reachable any time, not
// just in the one-shot banner right after the action.
type ReviewedSubmission = {
  id: string;
  event_name: string;
  status: string;
  submitter_name: string | null;
  submitter_email: string | null;
  ai_reply: SubmissionReply | null;
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as EventCategory[];

async function loadData(): Promise<{ submissions: Submission[]; matched: Map<string, MatchedEvent> }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { submissions: [], matched: new Map() };
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("event_submissions")
    .select(
      "id, event_name, event_date, start_time, venue_name, town, description, category, event_url, submitter_name, submitter_email, created_at, ai_verdict, ai_confidence, ai_headline, ai_matched_event_id, ai_analysis, ai_analyzed_at, ai_error, ai_reply"
    )
    .eq("status", "pending")
    .order("event_date", { ascending: true });
  const submissions = (data as Submission[] | null) ?? [];

  const ids = [...new Set(submissions.map((s) => s.ai_matched_event_id).filter(Boolean))] as string[];
  const matched = new Map<string, MatchedEvent>();
  if (ids.length) {
    const { data: evs } = await supabase
      .from("hwy4_events")
      .select("id, name, date, town")
      .in("id", ids);
    for (const e of (evs as MatchedEvent[] | null) ?? []) matched.set(e.id, e);
  }
  return { submissions, matched };
}

async function loadReplied(id: string): Promise<RepliedSubmission | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("event_submissions")
    .select("event_name, submitter_name, ai_reply")
    .eq("id", id)
    .maybeSingle();
  return (data as RepliedSubmission | null) ?? null;
}

async function loadRecentlyReviewed(): Promise<ReviewedSubmission[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("event_submissions")
    .select("id, event_name, status, submitter_name, submitter_email, ai_reply")
    .neq("status", "pending")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(8);
  return (data as ReviewedSubmission[] | null) ?? [];
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function SubmissionsAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMsg = typeof params.error === "string" ? params.error : null;
  const flash = typeof params.flash === "string" ? params.flash : null;
  const repliedId = typeof params.replied === "string" ? params.replied : null;
  const { submissions, matched } = await loadData();
  const [repliedSub, reviewed] = await Promise.all([
    repliedId ? loadReplied(repliedId) : Promise.resolve(null),
    loadRecentlyReviewed(),
  ]);
  const today = new Date().toISOString().split("T")[0];

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>Community submissions</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Events neighbors sent in through the submit form. The agent researches each one (checks the
        database for a match, searches the web for the organizer), then gives you a recommendation.
        Review it, fill in anything missing, then publish, merge, or dismiss.
      </p>

      {errorMsg && <Banner tone="error">{errorMsg}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}

      {repliedSub?.ai_reply && (
        <div style={{ marginBottom: 20, border: "2px solid #2d5016", borderRadius: 12, padding: 4 }}>
          <ReplyPanel
            reply={repliedSub.ai_reply}
            heading={`✉ Email the submitter${repliedSub.submitter_name ? ` (${repliedSub.submitter_name})` : ""}`}
          />
        </div>
      )}

      {submissions.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {submissions.map((s) => (
            <SubmissionCard
              key={s.id}
              sub={s}
              isPast={s.event_date <= today}
              matched={s.ai_matched_event_id ? matched.get(s.ai_matched_event_id) ?? null : null}
            />
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <h2 style={{ color: "#2d5016", fontSize: 18, margin: "0 0 4px" }}>Recently reviewed</h2>
          <p style={{ color: "#777", fontSize: 14, margin: "0 0 14px", lineHeight: 1.5 }}>
            Published or dismissed submissions. Draft or re-open the reply to the submitter here, any
            time.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reviewed.map((r) => (
              <ReviewedRow key={r.id} sub={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewedRow({ sub }: { sub: ReviewedSubmission }) {
  const isApproved = sub.status === "approved";
  const statusLabel = isApproved ? "Published" : sub.status === "rejected" ? "Dismissed" : sub.status;
  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #e8e4de",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "baseline",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ color: "#2d5016", fontSize: 16 }}>{sub.event_name}</strong>
          <span
            style={{
              background: isApproved ? "#eaf7ea" : "#f3f4f6",
              color: isApproved ? "#2d5016" : "#6b7280",
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 20,
            }}
          >
            {statusLabel}
          </span>
        </div>
        <span style={{ fontSize: 13, color: "#888" }}>
          {sub.submitter_name ?? "anonymous"}
          {sub.submitter_email ? ` · ${sub.submitter_email}` : ""}
        </span>
      </div>

      {sub.ai_reply ? (
        <div style={{ marginTop: 12 }}>
          <ReplyPanel reply={sub.ai_reply} heading="✉ Drafted reply" />
        </div>
      ) : sub.submitter_email ? (
        <form action={draftReplyForReviewed} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={sub.id} />
          <button type="submit" style={questionBtn}>
            Draft a reply to the submitter
          </button>
        </form>
      ) : (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#999" }}>
          No email on file for this submitter.
        </p>
      )}
    </article>
  );
}

const VERDICT_STYLES: Record<
  string,
  { label: string; fg: string; bg: string; border: string; accent: string }
> = {
  publish_new: {
    label: "Publish as new",
    fg: "#2d5016",
    bg: "#eaf7ea",
    border: "#b7e0b7",
    accent: "#2d5016",
  },
  duplicate: {
    label: "Already on the site",
    fg: "#4b5563",
    bg: "#f3f4f6",
    border: "#d8dce2",
    accent: "#9ca3af",
  },
  duplicate_needs_update: {
    label: "Duplicate, adds new info",
    fg: "#92400e",
    bg: "#fff7ed",
    border: "#fde4c8",
    accent: "#d97706",
  },
  reject: {
    label: "Recommend passing",
    fg: "#922b21",
    bg: "#fdecea",
    border: "#f5b7b1",
    accent: "#922b21",
  },
};

function AIVerdictBanner({ sub, matched }: { sub: Submission; matched: MatchedEvent | null }) {
  // Not yet analyzed (or errored) — show a neutral status with a manual trigger.
  if (!sub.ai_analyzed_at || !sub.ai_verdict) {
    const errored = !!sub.ai_error;
    return (
      <div
        style={{
          background: errored ? "#fdecea" : "#f6f6f4",
          border: `1px solid ${errored ? "#f5b7b1" : "#e6e3dd"}`,
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 15, color: errored ? "#922b21" : "#777" }}>
          {errored
            ? `Analysis failed: ${sub.ai_error}`
            : "The agent is researching this submission. Refresh in a moment, or run it now."}
        </span>
        <ReanalyzeButton id={sub.id} label={errored ? "Retry analysis" : "Analyze now"} />
      </div>
    );
  }

  const v = VERDICT_STYLES[sub.ai_verdict] ?? VERDICT_STYLES.publish_new;
  const a = sub.ai_analysis;
  return (
    <div
      style={{
        background: v.bg,
        border: `1px solid ${v.border}`,
        borderLeft: `4px solid ${v.accent}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            background: v.accent,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "3px 9px",
            borderRadius: 20,
          }}
        >
          {v.label}
        </span>
        {sub.ai_confidence && (
          <span style={{ fontSize: 13, color: v.fg, fontWeight: 600 }}>
            {sub.ai_confidence} confidence
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ReanalyzeButton id={sub.id} label="Re-analyze" subtle />
      </div>

      {sub.ai_headline && (
        <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: v.fg }}>
          {sub.ai_headline}
        </p>
      )}
      {a?.rationale && (
        <p style={{ margin: "0 0 0", fontSize: 15, lineHeight: 1.55, color: "#3a3a3a" }}>
          {a.rationale}
        </p>
      )}

      {matched && (
        <p style={{ margin: "10px 0 0", fontSize: 14, color: v.fg }}>
          Matches existing event:{" "}
          <a
            href={`${SITE_URL}/events/${generateEventSlug(matched.name, matched.date, matched.town)}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: v.fg, fontWeight: 600 }}
          >
            {matched.name} ({fmtDate(matched.date)}) ↗
          </a>
        </p>
      )}

      {a?.new_info && sub.ai_verdict === "duplicate_needs_update" && (
        <div
          style={{
            background: "#fffdf8",
            border: "1px solid #fde4c8",
            borderRadius: 8,
            padding: "8px 12px",
            marginTop: 10,
          }}
        >
          <p style={{ ...miniLabel, color: "#9a3412", margin: "0 0 2px" }}>What this adds</p>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#3a3a3a" }}>{a.new_info}</p>
        </div>
      )}

      {a && a.sources.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#777", lineHeight: 1.6 }}>
          Sources:{" "}
          {a.sources.map((s, i) => (
            <span key={i}>
              {i > 0 && " · "}
              <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#5a8fa8" }}>
                {s.title || hostOf(s.url)}
              </a>
            </span>
          ))}
        </p>
      )}

      {a && a.flags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {a.flags.map((f) => (
            <span
              key={f}
              style={{
                background: "#fff",
                border: "1px solid #e0ddd6",
                color: "#7a4a1a",
                fontSize: 12,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 6,
              }}
            >
              {f.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

function ReanalyzeButton({ id, label, subtle }: { id: string; label: string; subtle?: boolean }) {
  return (
    <form action={reanalyzeSubmission} style={{ margin: 0 }}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        style={{
          background: "transparent",
          border: subtle ? "none" : "1px solid #c9c3b8",
          color: subtle ? "#6b7280" : "#444",
          fontSize: 13,
          fontWeight: 600,
          padding: subtle ? "2px 4px" : "5px 10px",
          borderRadius: 7,
          cursor: "pointer",
          textDecoration: subtle ? "underline" : "none",
        }}
      >
        {label}
      </button>
    </form>
  );
}

function SubmissionCard({
  sub,
  isPast,
  matched,
}: {
  sub: Submission;
  isPast: boolean;
  matched: MatchedEvent | null;
}) {
  const sg = sub.ai_analysis?.suggested ?? {};
  const suggestedCat =
    sg.category && (CATEGORIES as string[]).includes(sg.category) ? sg.category : null;
  const subCat =
    sub.category && (CATEGORIES as string[]).includes(sub.category) ? sub.category : null;
  // The /submit form collects no category, so rather than always defaulting to
  // "other" we derive one from the title + description via the shared keyword
  // classifier (e.g. "Karaoke at Murphys Irish Pub" → live_music). AI-triage
  // suggestion and any submitted category still win; the reviewer can override.
  const category =
    suggestedCat ??
    subCat ??
    classifyEventCategory(`${sub.event_name} ${sub.description ?? ""}`);

  const showMerge = sub.ai_verdict === "duplicate_needs_update" && !!matched;

  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #e8e4de",
        borderLeft: `4px solid ${isPast ? "#922b21" : "#d97706"}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <header style={{ marginBottom: 14 }}>
        <h2 style={{ color: "#2d5016", fontSize: 19, margin: "0 0 4px", fontWeight: 600 }}>
          {sub.event_name}
        </h2>
        <p style={{ color: "#666", fontSize: 15, margin: 0 }}>
          <strong>{fmtDate(sub.event_date)}</strong>
          {sub.town ? ` · ${sub.town}` : ""}
          {sub.submitter_name ? ` · from ${sub.submitter_name}` : " · anonymous"}
          {sub.submitter_email ? (
            <>
              {" ("}
              <a href={`mailto:${sub.submitter_email}?subject=${encodeURIComponent(`Your Hwy4Events submission: ${sub.event_name}`)}`} style={{ color: "#5a8fa8" }}>
                {sub.submitter_email}
              </a>
              {")"}
            </>
          ) : (
            ""
          )}
        </p>
        {isPast && (
          <p style={{ color: "#922b21", fontSize: 14, margin: "6px 0 0", fontWeight: 600 }}>
            This date is today or already passed. Publish only if it is still relevant.
          </p>
        )}
      </header>

      <AIVerdictBanner sub={sub} matched={matched} />

      {sub.submitter_email && (
        <div style={{ marginBottom: 14 }}>
          <form action={draftQuestionReply} style={{ margin: 0 }}>
            <input type="hidden" name="id" value={sub.id} />
            <button type="submit" style={questionBtn}>
              {sub.ai_reply?.outcome === "questions"
                ? "Re-draft a question for the submitter"
                : "Draft a question for the submitter"}
            </button>
          </form>
          {sub.ai_reply?.outcome === "questions" && (
            <div style={{ marginTop: 12 }}>
              <ReplyPanel
                reply={sub.ai_reply}
                heading={`Drafted question to ${sub.submitter_name ?? sub.submitter_email}`}
              />
            </div>
          )}
        </div>
      )}

      {showMerge && (
        <form action={mergeSubmission} style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={sub.id} />
          <input type="hidden" name="event_id" value={matched!.id} />
          <button type="submit" style={mergeBtn}>
            Merge new info into existing event
          </button>
          <span style={{ fontSize: 14, color: "#999", marginLeft: 10 }}>
            Fills only blank fields on the existing event (locked fields untouched). Reversible.
          </span>
        </form>
      )}

      <details style={{ marginBottom: 4 }} open={!showMerge}>
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#2d5016", marginBottom: 10 }}>
          {showMerge ? "Or publish as a separate new event" : "Review & publish"}
        </summary>
        <form action={publishSubmission}>
          <input type="hidden" name="id" value={sub.id} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <Field label="Event name" name="name" defaultValue={sub.event_name} />
            <Field label="Date" name="date" type="date" defaultValue={sub.event_date} />
            <Field
              label="Start time"
              name="start_time"
              type="time"
              defaultValue={sub.start_time ?? sg.start_time ?? ""}
            />
            <Field label="End time" name="end_time" type="time" defaultValue={sg.end_time ?? ""} />
            <Field
              label="Venue"
              name="venue_name"
              defaultValue={sub.venue_name ?? sg.venue_name ?? ""}
              placeholder="Fill in if missing"
            />
            <SelectField
              label="Town"
              name="town"
              options={TOWNS as readonly string[]}
              defaultValue={sub.town ?? ""}
            />
            <SelectField
              label="Category"
              name="category"
              options={CATEGORIES}
              labels={CATEGORY_LABELS}
              defaultValue={category}
            />
            <Field
              label="Event URL"
              name="event_url"
              defaultValue={sub.event_url ?? sg.event_url ?? ""}
              placeholder="optional"
            />
          </div>
          <label style={labelStyle}>Description</label>
          <textarea
            name="description"
            defaultValue={sub.description ?? sg.description ?? ""}
            rows={3}
            style={textareaStyle}
          />
          {(sg.venue_name || sg.start_time || sg.description || sg.event_url) && (
            <p style={{ fontSize: 13, color: "#9a3412", margin: "8px 0 0" }}>
              Blank fields above were pre-filled from the agent&rsquo;s research. Verify before
              publishing.
            </p>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" style={primaryBtn}>
              Publish to site
            </button>
            <span style={{ fontSize: 14, color: "#999" }}>
              Inserts a public, community-sourced event.
            </span>
          </div>
        </form>
      </details>

      <form
        action={dismissSubmission}
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid #f0ede8",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input type="hidden" name="id" value={sub.id} />
        <input name="review_note" placeholder="Reason (optional)" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
        <button type="submit" style={dangerBtn}>
          Dismiss
        </button>
      </form>
    </article>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
  labels,
}: {
  label: string;
  name: string;
  options: readonly string[];
  defaultValue: string;
  labels?: Record<string, string>;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <select name={name} defaultValue={defaultValue} style={inputStyle}>
        {!defaultValue && <option value="">Select…</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {labels ? labels[o] : o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  const s =
    tone === "ok"
      ? { background: "#eaf7ea", border: "1px solid #b7e0b7", color: "#2d5016" }
      : { background: "#fdecea", border: "1px solid #f5b7b1", color: "#922b21" };
  return (
    <div style={{ ...s, padding: "12px 16px", borderRadius: 8, fontSize: 16, marginBottom: 16 }}>
      {children}
    </div>
  );
}

// Drafted reply to the submitter + a one-click Gmail compose deep-link. The app
// never sends; the human reviews, edits, and sends from their own Gmail.
function ReplyPanel({ reply, heading }: { reply: SubmissionReply; heading: string }) {
  if (!reply.to) return null;
  const href = gmailComposeUrl(reply.to, reply.subject, reply.body);
  return (
    <div style={replyPanelStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#2d5016" }}>{heading}</p>
        <a href={href} target="_blank" rel="noreferrer" style={gmailBtn}>
          Open in Gmail ↗
        </a>
      </div>
      <label style={{ ...miniLabel, color: "#888", display: "block", margin: "0 0 3px" }}>Subject</label>
      <input readOnly value={reply.subject} style={{ ...inputStyle, marginBottom: 10 }} />
      <label style={{ ...miniLabel, color: "#888", display: "block", margin: "0 0 3px" }}>Body</label>
      <textarea readOnly value={reply.body} rows={9} style={{ ...textareaStyle, fontSize: 15 }} />
      <p style={{ fontSize: 12, color: "#999", margin: "6px 0 0", lineHeight: 1.5 }}>
        Opens a pre-filled Gmail compose. Edit and send from your account; your signature is added by
        Gmail.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e8e4de",
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
      }}
    >
      <p style={{ color: "#2d5016", fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
        No pending submissions.
      </p>
      <p style={{ color: "#666", fontSize: 16, margin: 0 }}>
        When neighbors submit events at /submit, they show up here for review.
      </p>
    </section>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#888",
  margin: "0 0 4px",
};
const miniLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d9d4cc",
  borderRadius: 8,
  fontSize: 16,
  color: "#2d3a22",
  background: "#fff",
  boxSizing: "border-box",
};
const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "inherit",
  resize: "vertical",
};
const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  background: "#2d5016",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};
const mergeBtn: React.CSSProperties = {
  padding: "10px 18px",
  background: "#d97706",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff",
  color: "#922b21",
  border: "1px solid #e6b8b3",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 500,
  cursor: "pointer",
};
const questionBtn: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff",
  color: "#9a3412",
  border: "1px solid #f3c89b",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
const replyPanelStyle: React.CSSProperties = {
  background: "#f6faf4",
  border: "1px solid #cfe3c4",
  borderRadius: 10,
  padding: "14px 16px",
};
const gmailBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 14px",
  background: "#2d5016",
  color: "#fff",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
};
