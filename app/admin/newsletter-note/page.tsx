import { createClient } from "@supabase/supabase-js";
import { addNote, updateNote, deleteNote } from "./actions";

export const dynamic = "force-dynamic";

const DEFAULT_ROB_NOTE = `Hey, Rob here. I built Hwy4Events because I kept missing things happening five miles from my house. Every week Millie (my sheepadoodle, our actual editor) rounds up what's on. Hope you find something worth driving to.`;

type Note = {
  id: number;
  body: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
};

async function loadNotes(): Promise<Note[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("newsletter_notes")
    .select("id, body, starts_at, ends_at, created_at")
    .order("starts_at", { ascending: true });
  return (data ?? []) as Note[];
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function plusDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function classifyWindow(today: string, note: Note): "active" | "upcoming" | "past" {
  if (note.starts_at <= today && today <= note.ends_at) return "active";
  if (note.starts_at > today) return "upcoming";
  return "past";
}

function fmtDate(iso: string): string {
  // Render in PT-agnostic short form: "May 25"
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function NewsletterNoteAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMsg = typeof params.error === "string" ? params.error : null;
  const flash =
    typeof params.added === "string" ? "Note added."
    : typeof params.updated === "string" ? "Note updated."
    : typeof params.deleted === "string" ? "Note deleted."
    : null;

  const today = todayISO();
  const notes = await loadNotes();
  const activeNote = notes.find((n) => classifyWindow(today, n) === "active") ?? null;

  // Suggest sensible defaults for the next-note form: start from the day after
  // the latest end_at (or today), 7-day window.
  const latestEnd = notes.length > 0 ? notes[notes.length - 1].ends_at : null;
  const defaultStart = latestEnd && latestEnd >= today ? plusDays(latestEnd, 1) : today;
  const defaultEnd = plusDays(defaultStart, 6);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>
          Newsletter — Rob&rsquo;s Notes
        </h1>
        <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px" }}>
          Schedule personal notes for the &ldquo;From Rob&rdquo; block at the top of the weekly email. Each note
          has a date window. Windows cannot overlap. If no note is active on send day, the email ships the
          default note.
        </p>

        {errorMsg && (
          <div
            style={{
              background: "#fdecea",
              border: "1px solid #f5b7b1",
              color: "#922b21",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 16,
              marginBottom: 16,
            }}
          >
            {errorMsg}
          </div>
        )}
        {flash && (
          <div
            style={{
              background: "#eaf7ea",
              border: "1px solid #b7e0b7",
              color: "#2d5016",
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 16,
              marginBottom: 16,
            }}
          >
            {flash}
          </div>
        )}

        {/* Active note callout */}
        <section
          style={{
            background: activeNote ? "#f4efe6" : "#fff",
            border: `1px solid ${activeNote ? "#e0d9cb" : "#e8e4de"}`,
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <p
            style={{
              color: "#2d5016",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              margin: "0 0 8px",
            }}
          >
            Shipping today ({fmtDate(today)})
          </p>
          {activeNote ? (
            <>
              <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.65, margin: "0 0 8px" }}>
                {activeNote.body}
              </p>
              <p style={{ color: "#666", fontSize: 14, margin: 0 }}>
                Window: <strong>{fmtDate(activeNote.starts_at)}</strong> → <strong>{fmtDate(activeNote.ends_at)}</strong>
              </p>
            </>
          ) : (
            <>
              <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.65, margin: "0 0 8px" }}>
                <em>No active note — shipping the default:</em>
              </p>
              <p style={{ color: "#666", fontSize: 15, lineHeight: 1.65, margin: 0 }}>
                {DEFAULT_ROB_NOTE}
              </p>
            </>
          )}
        </section>

        {/* Add new note */}
        <section
          style={{
            background: "white",
            border: "1px solid #e8e4de",
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <h2 style={{ color: "#2d5016", fontSize: 18, margin: "0 0 12px" }}>Schedule a new note</h2>
          <form action={addNote}>
            <NoteFields defaultStart={defaultStart} defaultEnd={defaultEnd} />
            <div style={{ marginTop: 12 }}>
              <button type="submit" style={primaryBtnStyle}>
                Add note
              </button>
              <a
                href="/api/newsletter/send?preview=1"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...secondaryBtnStyle, marginLeft: 12, textDecoration: "none", display: "inline-block" }}
              >
                Preview email →
              </a>
            </div>
          </form>
        </section>

        {/* Existing notes list */}
        <section>
          <h2 style={{ color: "#2d5016", fontSize: 18, margin: "0 0 12px" }}>
            All scheduled notes <span style={{ color: "#999", fontWeight: 400 }}>({notes.length})</span>
          </h2>
          {notes.length === 0 ? (
            <p style={{ color: "#666", fontSize: 16 }}>No notes scheduled yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} today={today} />
              ))}
            </div>
          )}
        </section>
      </div>
  );
}

function NoteRow({ note, today }: { note: Note; today: string }) {
  const cls = classifyWindow(today, note);
  const tagStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    padding: "3px 8px",
    borderRadius: 4,
    display: "inline-block",
    marginRight: 8,
    background: cls === "active" ? "#2d5016" : cls === "upcoming" ? "#e8e4de" : "#f0ebe2",
    color: cls === "active" ? "#fff" : "#666",
  };

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e8e4de",
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={tagStyle}>{cls}</span>
        <span style={{ color: "#666", fontSize: 15 }}>
          {fmtDate(note.starts_at)} → {fmtDate(note.ends_at)}
        </span>
      </div>
      <form action={updateNote}>
        <input type="hidden" name="id" value={note.id} />
        <NoteFields
          defaultBody={note.body}
          defaultStart={note.starts_at}
          defaultEnd={note.ends_at}
        />
        <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="submit" style={primaryBtnStyle}>
            Save changes
          </button>
          <button type="submit" formAction={deleteNote} style={dangerBtnStyle}>
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}

function NoteFields({
  defaultBody = "",
  defaultStart,
  defaultEnd,
}: {
  defaultBody?: string;
  defaultStart: string;
  defaultEnd: string;
}) {
  return (
    <>
      <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 200px", display: "block" }}>
          <span style={fieldLabelStyle}>Starts (inclusive)</span>
          <input
            type="date"
            name="starts_at"
            defaultValue={defaultStart}
            required
            style={inputStyle}
          />
        </label>
        <label style={{ flex: "1 1 200px", display: "block" }}>
          <span style={fieldLabelStyle}>Ends (inclusive)</span>
          <input
            type="date"
            name="ends_at"
            defaultValue={defaultEnd}
            required
            style={inputStyle}
          />
        </label>
      </div>
      <label style={{ display: "block" }}>
        <span style={fieldLabelStyle}>Note body (markdown links [label](url) supported)</span>
        <textarea
          name="body"
          defaultValue={defaultBody}
          rows={4}
          required
          placeholder="Hey, Rob here. This weekend I'll be at..."
          style={textareaStyle}
        />
      </label>
    </>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  color: "#333",
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 16,
  border: "1px solid #d4cdbf",
  borderRadius: 8,
  fontFamily: "inherit",
  background: "#fff",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  lineHeight: 1.6,
  resize: "vertical",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#2d5016",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#faf9f6",
  color: "#2d5016",
  border: "1px solid #2d5016",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 500,
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#fff",
  color: "#922b21",
  border: "1px solid #e6b8b3",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 500,
  cursor: "pointer",
};
