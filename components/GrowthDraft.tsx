"use client";

import { useState } from "react";
import type { GrowthDraft } from "@/lib/agent/types";

// Renders the drafted artifact attached to the move of the week with a
// one-click copy. The growth agent writes the copy; a human sends it (the
// cockpit rule that outward actions never auto-run). For email drafts we also
// offer a Gmail compose deep-link, mirroring the submission-reply loop.

const KIND_LABEL: Record<GrowthDraft["kind"], string> = {
  email: "Draft email",
  post: "Draft post",
  subject: "Subject line",
  note: "Draft",
};

export default function GrowthDraftBlock({ draft }: { draft: GrowthDraft }) {
  const [copied, setCopied] = useState(false);

  const full = draft.subject ? `Subject: ${draft.subject}\n\n${draft.body}` : draft.body;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* textarea is selectable as fallback */
    }
  }

  const gmailUrl =
    draft.kind === "email"
      ? `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(
          draft.subject ?? ""
        )}&body=${encodeURIComponent(draft.body)}`
      : null;

  return (
    <div
      style={{
        background: "#f5f8f2",
        border: "1px solid #d8e4d0",
        borderRadius: 10,
        padding: 14,
        marginTop: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#2d5016",
            background: "#e3eedb",
            padding: "2px 8px",
            borderRadius: 6,
          }}
        >
          {KIND_LABEL[draft.kind]}
        </span>
        {draft.to_hint && (
          <span style={{ fontSize: 13, color: "#6b7d70" }}>for {draft.to_hint}</span>
        )}
      </div>

      {draft.subject && (
        <p style={{ margin: "0 0 8px", fontSize: 15, color: "#2d3a22" }}>
          <strong>Subject:</strong> {draft.subject}
        </p>
      )}

      <textarea
        readOnly
        value={draft.body}
        rows={Math.min(12, Math.max(4, draft.body.split("\n").length + 1))}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontFamily: "inherit",
          fontSize: 15,
          lineHeight: 1.55,
          color: "#2d3a22",
          background: "#fff",
          border: "1px solid #d8e4d0",
          borderRadius: 8,
          padding: 10,
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={copy}
          style={{
            cursor: "pointer",
            background: "#2d5016",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "7px 14px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
        {gmailUrl && (
          <a
            href={gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: "#fff",
              color: "#2d5016",
              border: "1px solid #2d5016",
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Open in Gmail
          </a>
        )}
      </div>
    </div>
  );
}
