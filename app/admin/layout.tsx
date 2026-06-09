import Link from "next/link";
import { countPending } from "@/lib/admin/db";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Badge counts for the review queues. countPending returns 0 (never throws) on
  // a misconfigured env so the whole admin tree can't 500 over a missing badge.
  const [verification, submissions, posters, feedback, proposedActions] = await Promise.all([
    countPending("hwy4_events", "verification_status", "needs_verification"),
    countPending("event_submissions", "status", "pending"),
    countPending("poster_submissions", "status", "pending"),
    countPending("event_feedback", "status", "pending"),
    countPending("agent_actions", "status", "proposed"),
  ]);

  return (
    <main
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#faf9f6",
        minHeight: "100vh",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: 940, margin: "0 auto 20px" }}>
        <nav
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
            rowGap: 8,
            fontSize: 15,
            color: "#666",
            paddingBottom: 16,
            borderBottom: "1px solid #e8e4de",
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: "#999",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginRight: 4,
            }}
          >
            Admin
          </span>
          {/* Agent cockpit — briefings (read-only) + the action queue */}
          <NavLink href="/admin/briefings">Today</NavLink>
          <NavLink href="/admin/briefings?view=growth">Growth memo</NavLink>
          <NavLink href="/admin/actions" badge={proposedActions}>
            Actions
          </NavLink>
          <NavDivider />
          {/* Growth */}
          <NavLink href="/admin/experiments">Experiments</NavLink>
          <NavLink href="/admin/analytics">Growth</NavLink>
          <NavDivider />
          {/* Content */}
          <NavLink href="/admin/newsletter">Newsletter</NavLink>
          <NavDivider />
          {/* Human review queues (badged with pending counts) */}
          <NavLink href="/admin/submissions" badge={submissions}>
            Submissions
          </NavLink>
          <NavLink href="/admin/posters" badge={posters}>
            Posters
          </NavLink>
          <NavLink href="/admin/verification" badge={verification}>
            Verification
          </NavLink>
          <NavLink href="/admin/feedback" badge={feedback}>
            Feedback
          </NavLink>
        </nav>
      </div>
      {children}
    </main>
  );
}

function NavLink({
  href,
  children,
  badge,
}: {
  href: string;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        color: "#2d5016",
        textDecoration: "none",
        fontWeight: 500,
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
            background: "#d97706",
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
  return (
    <span
      aria-hidden
      style={{ width: 1, height: 18, background: "#e8e4de", margin: "0 2px" }}
    />
  );
}
