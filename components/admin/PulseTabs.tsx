import Link from "next/link";
import type { ReactNode } from "react";
import { INK, BORDER, MUTED, SUBTLE } from "@/components/admin/ui";

// The "Pulse" sub-nav: the read-only agent surfaces grouped under one nav tab.
// Today + Growth memo are two views of /admin/briefings; Experiments is its own
// route. Server component — the parent page already knows which is active and
// passes it in, so there's no client hook (and no Suspense boundary) needed.
// `right` is an optional slot for a page-specific control (the briefings
// "Run now" button) pinned to the trailing edge.
export function PulseTabs({
  active,
  right,
}: {
  active: "today" | "growth" | "experiments";
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        alignItems: "flex-end",
        marginBottom: 24,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <Tab href="/admin/briefings" label="Today" sub="daily ops" active={active === "today"} />
      <Tab href="/admin/briefings?view=growth" label="Growth memo" sub="weekly" active={active === "growth"} />
      <Tab href="/admin/experiments" label="Experiments" sub="growth memory" active={active === "experiments"} />
      {right && <div style={{ marginLeft: "auto", marginBottom: 6 }}>{right}</div>}
    </div>
  );
}

function Tab({
  href,
  label,
  sub,
  active,
}: {
  href: string;
  label: string;
  sub: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 16px 12px",
        marginBottom: -1,
        color: active ? INK : MUTED,
        fontWeight: active ? 700 : 500,
        fontSize: 16,
        borderBottom: `2px solid ${active ? INK : "transparent"}`,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      <span style={{ fontWeight: 400, fontSize: 13, color: SUBTLE }}> · {sub}</span>
    </Link>
  );
}
