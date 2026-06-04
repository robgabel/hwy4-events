import { createClient } from "@supabase/supabase-js";
import { generateEventSlug } from "@/lib/slugs";
import { approvePosterSubmission, rejectPosterSubmission } from "./actions";

export const dynamic = "force-dynamic";

type Submission = {
  id: string;
  event_id: string | null;
  event_slug: string | null;
  image_url: string;
  submitter_name: string | null;
  submitter_email: string | null;
  note: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  name: string;
  date: string;
  town: string;
  image_url: string | null;
};

async function loadData(): Promise<{ submissions: Submission[]; events: Map<string, EventRow> }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { submissions: [], events: new Map() };
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data } = await supabase
    .from("poster_submissions")
    .select("id, event_id, event_slug, image_url, submitter_name, submitter_email, note, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const submissions = (data as Submission[] | null) ?? [];

  const eventIds = [...new Set(submissions.map((s) => s.event_id).filter(Boolean))] as string[];
  const events = new Map<string, EventRow>();
  if (eventIds.length > 0) {
    const { data: rows } = await supabase
      .from("hwy4_events")
      .select("id, name, date, town, image_url")
      .in("id", eventIds);
    for (const r of (rows as EventRow[] | null) ?? []) events.set(r.id, r);
  }
  return { submissions, events };
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

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function PostersAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMsg = typeof params.error === "string" ? params.error : null;
  const flash = typeof params.flash === "string" ? params.flash : null;
  const { submissions, events } = await loadData();

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>Poster submissions</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Posters organizers sent in for their events. Approve to swap the art onto every
        upcoming date of that event (we show it untouched), or dismiss it.
      </p>

      {errorMsg && <Banner tone="error">{errorMsg}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}

      {submissions.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {submissions.map((s) => (
            <SubmissionCard
              key={s.id}
              sub={s}
              event={s.event_id ? events.get(s.event_id) ?? null : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ sub, event }: { sub: Submission; event: EventRow | null }) {
  const slug = event ? generateEventSlug(event.name, event.date, event.town) : sub.event_slug;
  const currentSrc = event?.image_url || (slug ? `/events/${slug}/poster` : null);
  const eventHadOwnPoster = Boolean(event?.image_url);

  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #e8e4de",
        borderLeft: "4px solid #2d5016",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <header style={{ marginBottom: 14 }}>
        <h2 style={{ color: "#2d5016", fontSize: 19, margin: "0 0 4px", fontWeight: 600 }}>
          {event ? event.name : sub.event_slug || "Unknown event"}
        </h2>
        <p style={{ color: "#666", fontSize: 15, margin: 0 }}>
          {event ? (
            <>
              <strong>{fmtDate(event.date)}</strong> · {event.town}
            </>
          ) : (
            <span style={{ color: "#922b21" }}>Original event not found (may have been removed)</span>
          )}
          {" · "}
          {sub.submitter_name || "anonymous"}
          {sub.submitter_email ? ` (${sub.submitter_email})` : ""}
          {" · "}
          <span style={{ color: "#999" }}>submitted {fmtWhen(sub.created_at)}</span>
        </p>
        {sub.note && (
          <p
            style={{
              color: "#444",
              fontSize: 15,
              margin: "8px 0 0",
              padding: "8px 12px",
              background: "#faf9f6",
              borderRadius: 8,
              borderLeft: "3px solid #d9d4cc",
            }}
          >
            “{sub.note}”
          </p>
        )}
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
          alignItems: "start",
        }}
      >
        <Poster
          label={eventHadOwnPoster ? "On the page now (organizer)" : "On the page now (generated)"}
          src={currentSrc}
        />
        <Poster label="Submitted" src={sub.image_url} highlight />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <form action={approvePosterSubmission} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="hidden" name="id" value={sub.id} />
          <button type="submit" style={primaryBtn} disabled={!event}>
            Approve &amp; swap in
          </button>
        </form>
        <span style={{ fontSize: 14, color: "#999" }}>
          Applies to all upcoming dates of this event.
        </span>
      </div>

      <form
        action={rejectPosterSubmission}
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

function Poster({ label, src, highlight }: { label: string; src: string | null; highlight?: boolean }) {
  return (
    <div>
      <p
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: highlight ? "#2d5016" : "#999",
          margin: "0 0 6px",
        }}
      >
        {label}
      </p>
      <div
        style={{
          borderRadius: 10,
          overflow: "hidden",
          background: "#faf9f6",
          border: highlight ? "2px solid #2d5016" : "1px solid #e8e4de",
          aspectRatio: "4 / 5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ color: "#bbb", fontSize: 14 }}>No poster</span>
        )}
      </div>
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
        No pending poster submissions.
      </p>
      <p style={{ color: "#666", fontSize: 16, margin: 0 }}>
        When an organizer uploads their poster from an event page, it shows up here for review.
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
