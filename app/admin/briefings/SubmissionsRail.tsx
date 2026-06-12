import Link from "next/link";
import { getAdminClientOrNull } from "@/lib/admin/db";
import { INK, MUTED, adminBtn } from "@/components/admin/ui";
import { dismissSubmission } from "@/app/admin/submissions/actions";

// The action rail: the cockpit's first "act from the briefing" surface. It pulls
// pending submissions straight from the DB (real ids + the agent's already-stored
// verdict — never an LLM-emitted id) and lets you clear the clear-cut "pass"
// cases in one click without leaving /admin/briefings. The verbs that create or
// mutate a public event (publish / merge) stay a reviewed click on
// /admin/submissions — outward/editorial actions never collapse to one tap.

const RETURN_TO = "/admin/briefings";

type PendingSub = {
  id: string;
  event_name: string;
  town: string | null;
  event_date: string | null;
  ai_verdict: string | null;
  ai_confidence: string | null;
  ai_headline: string | null;
  ai_analyzed_at: string | null;
};

const VERDICT: Record<string, { label: string; fg: string; bg: string; border: string }> = {
  publish_new: { label: "Publish as new", fg: "#1B3A2D", bg: "#eaf7ea", border: "#b7e0b7" },
  duplicate: { label: "Already on the site", fg: "#4b5563", bg: "#f3f4f6", border: "#d8dce2" },
  duplicate_needs_update: { label: "Duplicate, adds info", fg: "#92400e", bg: "#fff7ed", border: "#fde4c8" },
  reject: { label: "Recommend passing", fg: "#922b21", bg: "#fdecea", border: "#f5b7b1" },
};

async function loadPending(): Promise<PendingSub[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("event_submissions")
    .select("id, event_name, town, event_date, ai_verdict, ai_confidence, ai_headline, ai_analyzed_at")
    .eq("status", "pending")
    .order("event_date", { ascending: true });
  return (data as PendingSub[] | null) ?? [];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "date TBA";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export async function SubmissionsRail() {
  const subs = await loadPending();
  if (subs.length === 0) return null; // the digest narrative covers the all-clear case

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 12px" }}>
        <h2
          style={{
            color: INK,
            fontSize: 15,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            margin: 0,
          }}
        >
          Submissions waiting
        </h2>
        <span style={{ color: MUTED, fontSize: 14 }}>
          {subs.length} pending · agent-triaged · you decide
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {subs.map((s) => (
          <SubRow key={s.id} sub={s} />
        ))}
      </div>
    </section>
  );
}

function SubRow({ sub }: { sub: PendingSub }) {
  const analyzed = Boolean(sub.ai_analyzed_at && sub.ai_verdict);
  const v = analyzed && sub.ai_verdict ? VERDICT[sub.ai_verdict] : null;
  // The agent recommends passing (reject) or it's already covered (duplicate):
  // dismissing IS approving its call, and it's a reversible status flip — offer it
  // inline. publish_new / needs_update create or edit a public event, so they go
  // to the full review form.
  const canDismissInline = sub.ai_verdict === "reject" || sub.ai_verdict === "duplicate";

  const reviewLabel =
    sub.ai_verdict === "publish_new"
      ? "Review & publish →"
      : sub.ai_verdict === "duplicate_needs_update"
        ? "Review & merge →"
        : "Review →";

  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #E7E0D5",
        borderLeft: `4px solid ${v ? v.border : "#d8dce2"}`,
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
          {v ? (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: v.fg,
                background: v.bg,
                border: `1px solid ${v.border}`,
                padding: "2px 8px",
                borderRadius: 6,
              }}
            >
              {v.label}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>
              researching…
            </span>
          )}
          {analyzed && sub.ai_confidence && (
            <span style={{ fontSize: 13, color: "#999" }}>{sub.ai_confidence} confidence</span>
          )}
        </div>
        <h3 style={{ color: INK, fontSize: 17, margin: "0 0 2px", fontWeight: 600 }}>
          {sub.event_name}
        </h3>
        <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>
          {fmtDate(sub.event_date)}
          {sub.town ? ` · ${sub.town}` : ""}
        </p>
        {sub.ai_headline && (
          <p style={{ color: "#3a3a3a", fontSize: 14, lineHeight: 1.5, margin: "6px 0 0" }}>
            {sub.ai_headline}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {canDismissInline && (
          <form action={dismissSubmission} style={{ margin: 0 }}>
            <input type="hidden" name="id" value={sub.id} />
            <input type="hidden" name="returnTo" value={RETURN_TO} />
            <button type="submit" style={{ ...adminBtn.danger, padding: "8px 14px" }}>
              Dismiss
            </button>
          </form>
        )}
        <Link
          href="/admin/submissions"
          style={{
            ...adminBtn.secondary,
            padding: "8px 14px",
            textDecoration: "none",
            display: "inline-block",
            borderColor: sub.ai_verdict === "publish_new" ? INK : "#d9d4cc",
            color: sub.ai_verdict === "publish_new" ? INK : MUTED,
          }}
        >
          {reviewLabel}
        </Link>
      </div>
    </article>
  );
}
