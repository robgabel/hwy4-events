"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { INK, MUTED, ACCENT, BORDER, SUBTLE_BG } from "@/components/admin/ui";

export type NavBadges = {
  actions: number;
  submissions: number;
  posters: number;
  verification: number;
  feedback: number;
};

// Client nav for the admin cockpit. Server layout computes the pending-count
// badges and passes them in; this component owns active-tab highlighting
// (usePathname + the ?view param, so the two /briefings tabs read distinctly).
export default function AdminNav({ badges }: { badges: NavBadges }) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");

  function isActive(href: string): boolean {
    const [path, query] = href.split("?");
    if (path === "/admin/briefings") {
      if (pathname !== "/admin/briefings") return false;
      const hrefGrowth = query?.includes("view=growth");
      return hrefGrowth ? view === "growth" : view !== "growth";
    }
    return pathname === path || pathname.startsWith(path + "/");
  }

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
      {/* Agent cockpit — briefings (read-only) + the action queue */}
      <NavLink href="/admin/briefings" active={isActive("/admin/briefings")}>
        Today
      </NavLink>
      <NavLink href="/admin/briefings?view=growth" active={isActive("/admin/briefings?view=growth")}>
        Growth memo
      </NavLink>
      <NavLink href="/admin/actions" active={isActive("/admin/actions")} badge={badges.actions}>
        Actions
      </NavLink>
      <NavDivider />
      {/* Growth */}
      <NavLink href="/admin/experiments" active={isActive("/admin/experiments")}>
        Experiments
      </NavLink>
      <NavLink href="/admin/analytics" active={isActive("/admin/analytics")}>
        Analytics
      </NavLink>
      <NavDivider />
      {/* Content */}
      <NavLink href="/admin/newsletter" active={isActive("/admin/newsletter")}>
        Newsletter
      </NavLink>
      <NavDivider />
      {/* Human review queues (badged with pending counts) */}
      <NavLink href="/admin/submissions" active={isActive("/admin/submissions")} badge={badges.submissions}>
        Submissions
      </NavLink>
      <NavLink href="/admin/posters" active={isActive("/admin/posters")} badge={badges.posters}>
        Posters
      </NavLink>
      <NavLink href="/admin/verification" active={isActive("/admin/verification")} badge={badges.verification}>
        Verification
      </NavLink>
      <NavLink href="/admin/feedback" active={isActive("/admin/feedback")} badge={badges.feedback}>
        Feedback
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
