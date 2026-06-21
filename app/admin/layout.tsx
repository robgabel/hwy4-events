import { Suspense } from "react";
import { countPending, countMissing } from "@/lib/admin/db";
import { ADMIN_MAX_WIDTH, PAGE_BG } from "@/components/admin/ui";
import AdminNav from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Badge counts for the review queues. countPending returns 0 (never throws) on
  // a misconfigured env so the whole admin tree can't 500 over a missing badge.
  const [verification, submissions, posters, feedback, proposedActions, venues] = await Promise.all([
    countPending("hwy4_events", "verification_status", "needs_verification"),
    countPending("event_submissions", "status", "pending"),
    countPending("poster_submissions", "status", "pending"),
    countPending("event_feedback", "status", "pending"),
    countPending("agent_actions", "status", "proposed"),
    countMissing("hwy4_venues", "blurb", "venue_key"),
  ]);

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
          <AdminNav
            badges={{
              actions: proposedActions,
              submissions,
              posters,
              verification,
              feedback,
              venues,
            }}
          />
        </Suspense>
      </div>
      {children}
    </main>
  );
}
