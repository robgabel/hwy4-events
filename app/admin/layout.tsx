import { Suspense } from "react";
import { countPending } from "@/lib/admin/db";
import { ADMIN_MAX_WIDTH, PAGE_BG } from "@/components/admin/ui";
import AdminNav from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The Inbox badge is the single total across the review queues it unifies.
  // countPending returns 0 (never throws) on a misconfigured env so the whole
  // admin tree can't 500 over a missing badge. (Venues' missing blurb/address
  // count is badged on the Pulse "Venues" tab, fetched inside PulseTabs.)
  const [verification, submissions, posters, feedback, proposedActions, proposedTasks] = await Promise.all([
    countPending("hwy4_events", "verification_status", "needs_verification"),
    countPending("event_submissions", "status", "pending"),
    countPending("poster_submissions", "status", "pending"),
    countPending("event_feedback", "status", "pending"),
    countPending("agent_actions", "status", "proposed"),
    // Roadmap badge: agent-filed tickets awaiting human promotion (Phase 1 has no
    // agent inflow yet, so this reads 0 until the cockpit proposers land in Phase 2).
    countPending("hwy4_tasks", "status", "proposed"),
  ]);
  // Proposed tickets show in both the unified Inbox total and the Roadmap tab's own
  // badge (they're one thing that needs you, reachable from either surface).
  const inbox = verification + submissions + posters + feedback + proposedActions + proposedTasks;

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
          <AdminNav badges={{ inbox, roadmap: proposedTasks }} />
        </Suspense>
      </div>
      {children}
    </main>
  );
}
