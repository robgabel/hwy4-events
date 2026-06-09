import { getAdminClientOrNull } from "@/lib/admin/db";
import { saveDraft, vetoDraft, unvetoDraft, regenerateDraft } from "./actions";
import { addNote, updateNote, deleteNote } from "./note-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // regenerateDraft calls the LLM

const DEFAULT_ROB_NOTE = `Hey, Rob here. I built Hwy4Events because I kept missing things happening five miles from my house. Every week Millie (my sheepadoodle, our actual editor) rounds up what's on. Hope you find something worth driving to.`;

type Draft = {
  id: string;
  target_send_date: string;
  subject: string;
  content: string;
  status: "pending" | "vetoed" | "sent" | "canceled";
  model: string | null;
  event_count: number | null;
  edited: boolean;
  vetoed_at: string | null;
  sent_at: string | null;
  sent_count: number | null;
};

type Note = {
  id: number;
  body: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
};

async function loadDrafts(): Promise<Draft[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("newsletter_drafts")
    .select(
      "id, target_send_date, subject, content, status, model, event_count, edited, vetoed_at, sent_at, sent_count"
    )
    .order("target_send_date", { ascending: false })
    .limit(8);
  return (data ?? []) as Draft[];
}

async function loadNotes(): Promise<Note[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("newsletter_notes")
    .select("id, body, starts_at, ends_at, created_at")
    .order("starts_at", { ascending: true });
  return (data ?? []) as Note[];
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtNoteDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function NewsletterDraftAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMsg = typeof params.error === "string" ? params.error : null;
  const flash = typeof params.flash === "string" ? params.flash : null;

  const [drafts, notes] = await Promise.all([loadDrafts(), loadNotes()]);
  // The current draft is the most recent one that's still actionable (not yet
  // shipped). Once the week's draft sends, there's a gap until Wednesday's
  // prepare cron creates the next one — during that gap we must NOT fall back to
  // the sent draft, or the page would render it in the editable card with live
  // Save/Veto/Regenerate buttons that all error ("already been sent") and a
  // preview that shows last week's email. Drop into the empty state instead; the
  // sent draft still appears under Recent.
  const current = drafts.find((d) => d.status !== "sent") ?? null;
  const history = drafts.filter((d) => d.id !== current?.id);
  const lastSent = drafts.find((d) => d.status === "sent") ?? null;

  const today = todayISO();
  const activeNote = notes.find((n) => classifyWindow(today, n) === "active") ?? null;
  // Suggest sensible defaults for the next-note form: start from the day after
  // the latest end_at (or today), 7-day window.
  const latestEnd = notes.length > 0 ? notes[notes.length - 1].ends_at : null;
  const defaultStart = latestEnd && latestEnd >= today ? plusDays(latestEnd, 1) : today;
  const defaultEnd = plusDays(defaultStart, 6);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 26, margin: "0 0 4px" }}>
        Weekly Newsletter — Draft &amp; Approve
      </h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px" }}>
        Wednesday&rsquo;s cron drafts the weekly email. It{" "}
        <strong>auto-sends Thursday morning</strong> unless you <strong>veto</strong>{" "}
        it here first — you have ~24 hours. Edit freely; edits ship too. Only a
        veto (or a missing draft) stops the send.
      </p>

      {errorMsg && <Banner kind="error">{errorMsg}</Banner>}
      {flash && <Banner kind="ok">{flash}</Banner>}

      {!current ? (
        <section style={cardStyle}>
          <p style={{ color: "#666", fontSize: 16, margin: "0 0 8px" }}>
            {lastSent ? (
              <>
                Last week&rsquo;s newsletter already shipped (
                {fmtDate(lastSent.target_send_date)}, see Recent below). No draft is
                queued for the coming Thursday yet.
              </>
            ) : (
              <>No draft yet.</>
            )}
          </p>
          <p style={{ color: "#666", fontSize: 16, margin: 0 }}>
            Wednesday&rsquo;s <code>/api/newsletter/prepare</code> cron will create
            one, or trigger it now:
            <br />
            <code style={{ fontSize: 14 }}>
              curl -H &quot;Authorization: Bearer $CRON_SECRET&quot;
              https://hwy4events.com/api/newsletter/prepare
            </code>
          </p>
        </section>
      ) : (
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <StatusTag status={current.status} />
            <span style={{ color: "#333", fontSize: 16, fontWeight: 600 }}>
              Ships {fmtDate(current.target_send_date)}
            </span>
            <span style={{ color: "#999", fontSize: 14 }}>
              {current.event_count ?? "?"} events
              {current.edited ? " · edited" : ""}
              {current.model ? ` · ${current.model}` : ""}
            </span>
          </div>

          {current.status === "pending" && (
            <Banner kind="ok">
              Queued — this will <strong>auto-send</strong> {fmtDate(current.target_send_date)} morning.
              Edit below if you like (edits ship), or veto to hold it.
            </Banner>
          )}
          {current.status === "vetoed" && (
            <Banner kind="error">
              Vetoed{current.vetoed_at ? ` at ${new Date(current.vetoed_at).toLocaleString()}` : ""} —
              this will NOT send. Un-veto to put it back in the queue.
            </Banner>
          )}

          <form action={saveDraft}>
            <input type="hidden" name="id" value={current.id} />
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={fieldLabelStyle}>Subject</span>
              <input type="text" name="subject" defaultValue={current.subject} required style={inputStyle} />
            </label>
            <label style={{ display: "block" }}>
              <span style={fieldLabelStyle}>Body (markdown links [label](url) supported)</span>
              <textarea
                name="content"
                defaultValue={current.content}
                rows={18}
                required
                style={textareaStyle}
              />
            </label>
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button type="submit" style={secondaryBtnStyle}>
                Save edits
              </button>
              {current.status !== "vetoed" ? (
                <button type="submit" formAction={vetoDraft} style={dangerBtnStyle}>
                  🛑 Veto (don&rsquo;t send)
                </button>
              ) : (
                <button type="submit" formAction={unvetoDraft} style={primaryBtnStyle}>
                  ↩ Un-veto (re-queue)
                </button>
              )}
              <button type="submit" formAction={regenerateDraft} style={ghostBtnStyle}>
                ↻ Regenerate
              </button>
              <a
                href="/api/newsletter/send?preview=1"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...ghostBtnStyle, textDecoration: "none", display: "inline-block" }}
              >
                Preview email →
              </a>
            </div>
            <p style={{ color: "#999", fontSize: 14, margin: "10px 0 0" }}>
              Note: Thursday&rsquo;s send ships exactly the text above. The
              &ldquo;From Rob&rdquo; block is scheduled below.
            </p>
          </form>
        </section>
      )}

      {history.length > 0 && (
        <section style={{ marginTop: 8, marginBottom: 32 }}>
          <h2 style={{ color: "#2d5016", fontSize: 18, margin: "0 0 12px" }}>Recent</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((d) => (
              <div
                key={d.id}
                style={{
                  background: "white",
                  border: "1px solid #e8e4de",
                  borderRadius: 10,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <StatusTag status={d.status} />
                <span style={{ color: "#333", fontSize: 16 }}>{fmtDate(d.target_send_date)}</span>
                <span style={{ color: "#666", fontSize: 15, flex: 1 }}>{d.subject}</span>
                {d.status === "sent" && (
                  <span style={{ color: "#999", fontSize: 14 }}>sent to {d.sent_count ?? "?"}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* "From Rob" note scheduling (folded in from the old /admin/newsletter-note). */}
      <hr style={{ border: "none", borderTop: "1px solid #e8e4de", margin: "8px 0 28px" }} />
      <h2 style={{ color: "#2d5016", fontSize: 22, margin: "0 0 4px" }}>&ldquo;From Rob&rdquo; note</h2>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 20px" }}>
        Schedule personal notes for the block at the top of the weekly email. Each note has a date
        window; windows cannot overlap. If no note is active on send day, the email ships the default.
      </p>

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
          Shipping today ({fmtNoteDate(today)})
        </p>
        {activeNote ? (
          <>
            <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.65, margin: "0 0 8px" }}>
              {activeNote.body}
            </p>
            <p style={{ color: "#666", fontSize: 14, margin: 0 }}>
              Window: <strong>{fmtNoteDate(activeNote.starts_at)}</strong> →{" "}
              <strong>{fmtNoteDate(activeNote.ends_at)}</strong>
            </p>
          </>
        ) : (
          <>
            <p style={{ color: "#3a3a3a", fontSize: 16, lineHeight: 1.65, margin: "0 0 8px" }}>
              <em>No active note — shipping the default:</em>
            </p>
            <p style={{ color: "#666", fontSize: 15, lineHeight: 1.65, margin: 0 }}>{DEFAULT_ROB_NOTE}</p>
          </>
        )}
      </section>

      {/* Add new note */}
      <section style={cardStyle}>
        <h3 style={{ color: "#2d5016", fontSize: 18, margin: "0 0 12px" }}>Schedule a new note</h3>
        <form action={addNote}>
          <NoteFields defaultStart={defaultStart} defaultEnd={defaultEnd} />
          <div style={{ marginTop: 12 }}>
            <button type="submit" style={primaryBtnStyle}>
              Add note
            </button>
          </div>
        </form>
      </section>

      {/* Existing notes list */}
      <section>
        <h3 style={{ color: "#2d5016", fontSize: 18, margin: "0 0 12px" }}>
          All scheduled notes <span style={{ color: "#999", fontWeight: 400 }}>({notes.length})</span>
        </h3>
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

function StatusTag({ status }: { status: Draft["status"] }) {
  const palette: Record<Draft["status"], { bg: string; fg: string }> = {
    pending: { bg: "#2d5016", fg: "#fff" },
    vetoed: { bg: "#fdecea", fg: "#922b21" },
    sent: { bg: "#e8e4de", fg: "#666" },
    canceled: { bg: "#f0ebe2", fg: "#999" },
  };
  const label: Record<Draft["status"], string> = {
    pending: "queued to send",
    vetoed: "vetoed",
    sent: "sent",
    canceled: "canceled",
  };
  const c = palette[status];
  return (
    <span
      style={{
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: 4,
        background: c.bg,
        color: c.fg,
      }}
    >
      {label[status]}
    </span>
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
    <div style={{ background: "white", border: "1px solid #e8e4de", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={tagStyle}>{cls}</span>
        <span style={{ color: "#666", fontSize: 15 }}>
          {fmtNoteDate(note.starts_at)} → {fmtNoteDate(note.ends_at)}
        </span>
      </div>
      <form action={updateNote}>
        <input type="hidden" name="id" value={note.id} />
        <NoteFields defaultBody={note.body} defaultStart={note.starts_at} defaultEnd={note.ends_at} />
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
          <input type="date" name="starts_at" defaultValue={defaultStart} required style={inputStyle} />
        </label>
        <label style={{ flex: "1 1 200px", display: "block" }}>
          <span style={fieldLabelStyle}>Ends (inclusive)</span>
          <input type="date" name="ends_at" defaultValue={defaultEnd} required style={inputStyle} />
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

function Banner({ kind, children }: { kind: "ok" | "error"; children: React.ReactNode }) {
  const ok = kind === "ok";
  return (
    <div
      style={{
        background: ok ? "#eaf7ea" : "#fdecea",
        border: `1px solid ${ok ? "#b7e0b7" : "#f5b7b1"}`,
        color: ok ? "#2d5016" : "#922b21",
        padding: "12px 16px",
        borderRadius: 8,
        fontSize: 16,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #e8e4de",
  borderRadius: 12,
  padding: 20,
  marginBottom: 24,
};

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
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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

const ghostBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "transparent",
  color: "#666",
  border: "1px solid #d4cdbf",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 500,
  cursor: "pointer",
};
