"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { INK, MUTED, ACCENT, BORDER } from "@/components/admin/ui";

export type NavBadges = {
  inbox: number;
};

// Slimmed admin nav: four destinations. "Act" (the Inbox — the unified review
// queue) is separated from "look / tend" (Pulse = the read-only agent + growth
// surfaces: briefings, experiments, venues; Analytics; Newsletter). The five
// former queue routes (submissions / posters / verification / feedback / actions)
// still exist as pages — the Inbox links into them — but they're no longer
// top-level nav, so drilling into one keeps the "Inbox" tab lit.
const INBOX_ROUTES = [
  "/admin/inbox",
  "/admin/submissions",
  "/admin/posters",
  "/admin/verification",
  "/admin/feedback",
  "/admin/actions",
];

// Pulse spans the briefings page (Today + Growth-memo tabs), Experiments, and
// Venues (a blurb backlog — its missing-count badge lives on the Pulse Venues tab).
const PULSE_ROUTES = ["/admin/briefings", "/admin/experiments", "/admin/venues"];

export default function AdminNav({ badges }: { badges: NavBadges }) {
  const pathname = usePathname();

  const inActive = (routes: string[]) =>
    routes.some((r) => pathname === r || pathname.startsWith(r + "/"));
  const startsWith = (path: string) => pathname === path || pathname.startsWith(path + "/");

  return (
    <nav
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
        rowGap: 8,
        fontSize: 15,
        color: MUTED,
        paddingBottom: 16,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginRight: 4,
        }}
      >
        Admin
      </span>

      <NavLink href="/admin/inbox" active={inActive(INBOX_ROUTES)} badge={badges.inbox}>
        Inbox
      </NavLink>

      <NavDivider />

      <NavLink href="/admin/briefings" active={inActive(PULSE_ROUTES)}>
        Pulse
      </NavLink>
      <NavLink href="/admin/analytics" active={startsWith("/admin/analytics")}>
        Analytics
      </NavLink>
      <NavLink href="/admin/newsletter" active={startsWith("/admin/newsletter")}>
        Newsletter
      </NavLink>
    </nav>
  );
}

function NavLink({
  href,
  children,
  badge,
  active,
}: {
  href: string;
  children: React.ReactNode;
  badge?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        color: INK,
        background: active ? "rgba(27, 58, 45, 0.10)" : "transparent",
        textDecoration: "none",
        fontWeight: active ? 700 : 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {badge != null && badge > 0 && (
        <span
          style={{
            display: "inline-block",
            marginLeft: 6,
            padding: "1px 7px",
            borderRadius: 10,
            background: ACCENT,
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.4,
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

function NavDivider() {
  return <span aria-hidden style={{ width: 1, height: 18, background: BORDER, margin: "0 2px" }} />;
}
