import Link from "next/link";
import type { ReactNode } from "react";
import { countMissingEither } from "@/lib/admin/db";
import { INK, BORDER, MUTED, SUBTLE, ACCENT } from "@/components/admin/ui";

// The "Pulse" sub-nav: the agent / growth surfaces grouped under one nav tab.
// Today + Growth memo are two views of /admin/briefings; Experiments and Venues
// are their own routes. Server component — the parent page already knows which
// tab is active and passes it in, so there's no client hook (and no Suspense
// boundary) needed. The Venues tab carries a badge: the count of venues still
// missing a blurb or address (the same signal the page surfaces), fetched here so
// it shows from any Pulse tab. `right` is an optional trailing slot for a
// page-specific control (the briefings "Run now" button).
export async function PulseTabs({
  active,
  right,
}: {
  active: "today" | "growth" | "experiments" | "venues";
  right?: ReactNode;
}) {
  const venuesTodo = await countMissingEither("hwy4_venues", "blurb", "address", "venue_key");
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        alignItems: "flex-end",
        marginBottom: 24,
        borderBottom: `1px solid ${BORDER}`,
        flexWrap: "wrap",
      }}
    >
      <Tab href="/admin/briefings" label="Today" sub="daily ops" active={active === "today"} />
      <Tab href="/admin/briefings?view=growth" label="Growth memo" sub="weekly" active={active === "growth"} />
      <Tab href="/admin/experiments" label="Experiments" sub="growth memory" active={active === "experiments"} />
      <Tab href="/admin/venues" label="Venues" sub="blurbs" active={active === "venues"} badge={venuesTodo} />
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
            padding: "1px 7px",
            borderRadius: 10,
            background: ACCENT,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.4,
            verticalAlign: "middle",
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
