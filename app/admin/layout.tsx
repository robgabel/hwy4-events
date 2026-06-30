import { Suspense } from "react";
import { countPending, countMissingEither } from "@/lib/admin/db";
import { ADMIN_MAX_WIDTH, PAGE_BG } from "@/components/admin/ui";
import AdminNav from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The Inbox badge is the single total across the review queues it unifies.
  // Venues (a blurb backlog, not a triage queue) is its own surface, badged
  // separately. countPending / countMissing return 0 (never throw) on a
  // misconfigured env so the whole admin tree can't 500 over a missing badge.
  const [verification, submissions, posters, feedback, proposedActions, venues] = await Promise.all([
    countPending("hwy4_events", "verification_status", "needs_verification"),
    countPending("event_submissions", "status", "pending"),
    countPending("poster_submissions", "status", "pending"),
    countPending("event_feedback", "status", "pending"),
    countPending("agent_actions", "status", "proposed"),
    countMissingEither("hwy4_venues", "blurb", "address", "venue_key"),
  ]);
  const inbox = verification + submissions + posters + feedback + proposedActions;

  return (
    <main
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: PAGE_BG,
        minHeight: "100vh",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: ADMIN_MAX_WIDTH, margin: "0 auto 20px" }}>
        <Suspense fallback={<div style={{ height: 36 }} />}>
          <AdminNav badges={{ inbox, venues }} />
        </Suspense>
      </div>
      {children}
    </main>
  );
}
