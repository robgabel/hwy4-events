import Link from "next/link";
import type { ReactNode } from "react";
import { INK, BORDER, MUTED, SUBTLE, DANGER } from "@/components/admin/ui";

// The "Pulse" sub-nav: the read-only agent + ops surfaces grouped under one nav
// tab. Today + Growth memo are two views of /admin/briefings; Experiments and
// Sources are their own routes. Server component — the parent page already knows
// which is active and passes it in, so there's no client hook (and no Suspense
// boundary) needed. `right` is an optional slot for a page-specific control (the
// briefings "Run now" button) pinned to the trailing edge. `sourcesBadge` shows
// the degraded-source count on the Sources tab (only the sources page has it
// computed; the others leave it undefined).
export function PulseTabs({
  active,
  right,
  sourcesBadge,
}: {
  active: "today" | "growth" | "experiments" | "sources";
  right?: ReactNode;
  sourcesBadge?: number;
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
      <Tab href="/admin/sources" label="Sources" sub="scraper health" active={active === "sources"} badge={sourcesBadge} />
      {right && <div style={{ marginLeft: "auto", marginBottom: 6 }}>{right}</div>}
    </div>
  );
}

function Tab({
  href,
  label,
  sub,
  active,
  badge,
}: {
  href: string;
  label: string;
  sub: string;
  active: boolean;
  badge?: number;
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
      {badge != null && badge > 0 && (
        <span
          style={{
            display: "inline-block",
            marginLeft: 6,
            padding: "0 7px",
            borderRadius: 10,
            background: DANGER,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.5,
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
