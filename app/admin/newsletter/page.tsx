import { createClient } from "@supabase/supabase-js";
import { saveDraft, vetoDraft, unvetoDraft, regenerateDraft } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // regenerateDraft calls the LLM

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

async function loadDrafts(): Promise<Draft[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from("newsletter_drafts")
    .select(
      "id, target_send_date, subject, content, status, model, event_count, edited, vetoed_at, sent_at, sent_count"
    )
    .order("target_send_date", { ascending: false })
    .limit(8);
  return (data ?? []) as Draft[];
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

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function NewsletterDraftAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMsg = typeof params.error === "string" ? params.error : null;
  const flash = typeof params.flash === "string" ? params.flash : null;

  const drafts = await loadDrafts();
  // The current draft is the most recent one that hasn't shipped yet; otherwise
  // just the most recent row.
  const current = drafts.find((d) => d.status !== "sent") ?? drafts[0] ?? null;
  const history = drafts.filter((d) => d.id !== current?.id);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 24, margin: "0 0 4px" }}>
        Weekly Newsletter — Draft &amp; Approve
      </h1>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 24px" }}>
        Wednesday&rsquo;s cron drafts the weekly email. It{" "}
        <strong>auto-sends Thursday morning</strong> unless you <strong>veto</strong>{" "}
        it here first — you have ~24 hours. Edit freely; edits ship too. Only a
        veto (or a missing draft) stops the send.
      </p>

      {errorMsg && <Banner kind="error">{errorMsg}</Banner>}
      {flash && <Banner kind="ok">{flash}</Banner>}

      {!current ? (
        <section style={cardStyle}>
          <p style={{ color: "#666", fontSize: 14, margin: 0 }}>
            No draft yet. Wednesday&rsquo;s <code>/api/newsletter/prepare</code> cron
            will create one, or trigger it manually:
            <br />
            <code style={{ fontSize: 12 }}>
              curl -H &quot;Authorization: Bearer $CRON_SECRET&quot;
              https://hwy4events.com/api/newsletter/prepare
            </code>
          </p>
        </section>
      ) : (
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <StatusTag status={current.status} />
            <span style={{ color: "#333", fontSize: 14, fontWeight: 600 }}>
              Ships {fmtDate(current.target_send_date)}
            </span>
            <span style={{ color: "#999", fontSize: 12 }}>
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
            <p style={{ color: "#999", fontSize: 12, margin: "10px 0 0" }}>
              Note: Thursday&rsquo;s send ships exactly the text above. The
              &ldquo;From Rob&rdquo; block is managed separately under{" "}
              <a href="/admin/newsletter-note" style={{ color: "#2d5016" }}>Newsletter notes</a>.
            </p>
          </form>
        </section>
      )}

      {history.length > 0 && (
        <section style={{ marginTop: 8 }}>
          <h2 style={{ color: "#2d5016", fontSize: 16, margin: "0 0 12px" }}>Recent</h2>
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
                <span style={{ color: "#333", fontSize: 14 }}>{fmtDate(d.target_send_date)}</span>
                <span style={{ color: "#666", fontSize: 13, flex: 1 }}>{d.subject}</span>
                {d.status === "sent" && (
                  <span style={{ color: "#999", fontSize: 12 }}>
                    sent to {d.sent_count ?? "?"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
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
        fontSize: 11,
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
        fontSize: 14,
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
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
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
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#faf9f6",
  color: "#2d5016",
  border: "1px solid #2d5016",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#fff",
  color: "#922b21",
  border: "1px solid #e6b8b3",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "transparent",
  color: "#666",
  border: "1px solid #d4cdbf",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};
