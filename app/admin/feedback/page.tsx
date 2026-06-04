import { createClient } from "@supabase/supabase-js";
import { resolveFeedback, dismissFeedback } from "./actions";

export const dynamic = "force-dynamic";

type Feedback = {
  id: string;
  event_slug: string;
  event_name: string | null;
  note: string | null;
  submitter_role: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  created_at: string;
};

async function loadPending(): Promise<Feedback[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("event_feedback")
    .select(
      "id, event_slug, event_name, note, submitter_role, submitter_name, submitter_email, created_at"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data as Feedback[] | null) ?? [];
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function FeedbackAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMsg = typeof params.error === "string" ? params.error : null;
  const flash = typeof params.flash === "string" ? params.flash : null;
  const items = await loadPending();

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>Event feedback</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Corrections sent from event pages via &ldquo;Suggest a fix.&rdquo; Apply the change to the
        event the usual way, then mark it resolved, or dismiss it.
      </p>

      {errorMsg && <Banner tone="error">{errorMsg}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map((f) => (
            <FeedbackCard key={f.id} f={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackCard({ f }: { f: Feedback }) {
  const isOrganizer = f.submitter_role === "organizer";
  const roleLabel = isOrganizer
    ? "organizer"
    : f.submitter_role === "visitor"
      ? "visitor"
      : "role n/a";
  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #e8e4de",
        borderLeft: `4px solid ${isOrganizer ? "#2d5016" : "#d97706"}`,
        borderRadius: 12,
        padding: 20,
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ color: "#2d5016", fontSize: 19, margin: "0 0 4px", fontWeight: 600 }}>
          {f.event_name || f.event_slug}
        </h2>
        <p style={{ color: "#666", fontSize: 15, margin: 0 }}>
          <strong>{fmtWhen(f.created_at)}</strong>
          {` · ${roleLabel}`}
          {f.submitter_name ? ` · ${f.submitter_name}` : ""}
          {f.submitter_email ? ` (${f.submitter_email})` : ""}
        </p>
        <p style={{ margin: "4px 0 0" }}>
          <a
            href={`/events/${f.event_slug}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#2d5a3d", fontSize: 14 }}
          >
            View event &#8599;
          </a>
        </p>
      </header>

      <blockquote
        style={{
          margin: "0 0 14px",
          padding: "12px 14px",
          background: "#faf9f6",
          borderRadius: 8,
          color: "#2d3a22",
          fontSize: 16,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {f.note}
      </blockquote>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <form action={resolveFeedback} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={f.id} />
          <button type="submit" style={primaryBtn}>
            Mark resolved
          </button>
        </form>
        <form
          action={dismissFeedback}
          style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 220 }}
        >
          <input type="hidden" name="id" value={f.id} />
          <input
            name="review_note"
            placeholder="Reason (optional)"
            style={{ ...inputStyle, flex: 1, minWidth: 140 }}
          />
          <button type="submit" style={dangerBtn}>
            Dismiss
          </button>
        </form>
      </div>
    </article>
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
        No pending feedback.
      </p>
      <p style={{ color: "#666", fontSize: 16, margin: 0 }}>
        When someone uses &ldquo;Suggest a fix&rdquo; on an event page, it shows up here.
      </p>
    </section>
  );
}

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
