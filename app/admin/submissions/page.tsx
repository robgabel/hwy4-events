import { createClient } from "@supabase/supabase-js";
import { TOWNS, CATEGORY_LABELS, type EventCategory } from "@/lib/types";
import { publishSubmission, dismissSubmission } from "./actions";

export const dynamic = "force-dynamic";

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
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as EventCategory[];

async function loadPending(): Promise<Submission[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("event_submissions")
    .select(
      "id, event_name, event_date, start_time, venue_name, town, description, category, event_url, submitter_name, submitter_email, created_at"
    )
    .eq("status", "pending")
    .order("event_date", { ascending: true });
  return (data as Submission[] | null) ?? [];
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
  const submissions = await loadPending();
  const today = new Date().toISOString().split("T")[0];

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>Community submissions</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px", lineHeight: 1.5 }}>
        Events neighbors sent in through the submit form. Review the details, fill in anything
        missing (venue and category are often blank), then publish to the site or dismiss.
      </p>

      {errorMsg && <Banner tone="error">{errorMsg}</Banner>}
      {flash && <Banner tone="ok">{flash}</Banner>}

      {submissions.length === 0 ? (
        <EmptyState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {submissions.map((s) => (
            <SubmissionCard key={s.id} sub={s} isPast={s.event_date <= today} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ sub, isPast }: { sub: Submission; isPast: boolean }) {
  const category =
    sub.category && (CATEGORIES as string[]).includes(sub.category) ? sub.category : "other";
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
          {sub.submitter_email ? ` (${sub.submitter_email})` : ""}
        </p>
        {isPast && (
          <p style={{ color: "#922b21", fontSize: 14, margin: "6px 0 0", fontWeight: 600 }}>
            This date is today or already passed. Publish only if it is still relevant.
          </p>
        )}
      </header>

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
          <Field label="Start time" name="start_time" type="time" defaultValue={sub.start_time ?? ""} />
          <Field label="End time" name="end_time" type="time" defaultValue="" />
          <Field
            label="Venue"
            name="venue_name"
            defaultValue={sub.venue_name ?? ""}
            placeholder="Fill in if missing"
          />
          <SelectField label="Town" name="town" options={TOWNS as readonly string[]} defaultValue={sub.town ?? ""} />
          <SelectField
            label="Category"
            name="category"
            options={CATEGORIES}
            labels={CATEGORY_LABELS}
            defaultValue={category}
          />
          <Field label="Event URL" name="event_url" defaultValue={sub.event_url ?? ""} placeholder="optional" />
        </div>
        <label style={labelStyle}>Description</label>
        <textarea name="description" defaultValue={sub.description ?? ""} rows={3} style={textareaStyle} />
        <div style={{ display: "flex", gap: 12, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" style={primaryBtn}>
            Publish to site
          </button>
          <span style={{ fontSize: 14, color: "#999" }}>
            Inserts a public, community-sourced event.
          </span>
        </div>
      </form>

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
