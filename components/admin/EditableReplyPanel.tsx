"use client";

import { useState } from "react";
import type { SubmissionReply } from "@/lib/agent/submission-reply";
import { replyPanelMode } from "@/lib/agent/expire-submissions";

// Editable draft reply to a submitter, with a Gmail compose deep-link that always
// reflects the current text. The agent drafts the copy; the owner can tweak the
// subject and body here, then "Open in Gmail" carries those exact edits into a
// pre-filled compose window. Publish, dismiss, and question replies stay drafts:
// the owner sends them from Gmail. Edits live in the page only; they are not
// persisted to the DB. "Reset to draft" restores the agent's original copy.
//
// The expire cron is the exception. When `reply.auto_sent` is set, this panel
// is a read-only record of the email already sent. It does not offer Gmail.

// Inlined (not imported from lib/agent/submission-reply, which pulls in the
// Anthropic SDK) so this client bundle stays light. Manual encoding so spaces are
// %20 and a literal "+" survives.
function gmailComposeUrl(to: string, subject: string, body: string): string {
  const enc = encodeURIComponent;
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
}

export default function EditableReplyPanel({
  reply,
  heading,
}: {
  reply: SubmissionReply;
  heading: string;
}) {
  const [subject, setSubject] = useState(reply.subject);
  const [body, setBody] = useState(reply.body);
  const [copied, setCopied] = useState(false);

  if (replyPanelMode(reply) === "sent") {
    return (
      <div style={replyPanelStyle}>
        <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "#1B3A2D" }}>
          {heading}
        </p>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "#6b7d70" }}>
          Sent automatically{reply.to ? <> to <strong style={{ color: "#3a4a3a" }}>{reply.to}</strong></> : ""}.
          No need to send it again.
        </p>
        <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#2d3a22" }}>
          {reply.subject}
        </p>
        <div style={{ fontSize: 15, color: "#2d3a22", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {reply.body}
        </div>
      </div>
    );
  }

  // No email on file → nothing to write to (matches the prior read-only panel).
  if (!reply.to) return null;

  const edited = subject !== reply.subject || body !== reply.body;
  const href = gmailComposeUrl(reply.to, subject, body);

  function reset() {
    setSubject(reply.subject);
    setBody(reply.body);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* textarea is selectable as a fallback */
    }
  }

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
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1B3A2D" }}>{heading}</p>
        <a href={href} target="_blank" rel="noreferrer" style={gmailBtn}>
          Open in Gmail ↗
        </a>
      </div>

      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#6b7d70" }}>
        To <strong style={{ color: "#3a4a3a" }}>{reply.to}</strong>
      </p>

      <label style={{ ...miniLabel, color: "#888", display: "block", margin: "0 0 3px" }}>
        Subject
      </label>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        style={{ ...inputStyle, marginBottom: 10 }}
      />

      <label style={{ ...miniLabel, color: "#888", display: "block", margin: "0 0 3px" }}>
        Body
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.min(16, Math.max(9, body.split("\n").length + 1))}
        style={{ ...textareaStyle, fontSize: 15 }}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" onClick={copy} style={secondaryBtn}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
        {edited && (
          <button type="button" onClick={reset} style={resetBtn}>
            Reset to draft
          </button>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#999", lineHeight: 1.5 }}>
          {edited ? "Edited (not saved). " : ""}Edit here or in Gmail; your signature is added by
          Gmail.
        </span>
      </div>
    </div>
  );
}

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
const replyPanelStyle: React.CSSProperties = {
  background: "#f6faf4",
  border: "1px solid #cfe3c4",
  borderRadius: 10,
  padding: "14px 16px",
};
const gmailBtn: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 14px",
  background: "#1B3A2D",
  color: "#fff",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
};
const secondaryBtn: React.CSSProperties = {
  padding: "6px 12px",
  background: "#fff",
  color: "#1B3A2D",
  border: "1px solid #1B3A2D",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const resetBtn: React.CSSProperties = {
  padding: "6px 10px",
  background: "transparent",
  color: "#6b7280",
  border: "none",
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "underline",
};
