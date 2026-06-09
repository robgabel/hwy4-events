import { getAdminClientOrNull } from "@/lib/admin/db";
import { readFlash, type SearchParams } from "@/lib/admin/flash";
import {
  QueueShell,
  CardList,
  QueueCard,
  EmptyCard,
  CardHeader,
  INK,
  ACCENT,
  adminBtn,
  adminInput,
} from "@/components/admin/ui";
import { resolveFeedback, dismissFeedback } from "./actions";

export const dynamic = "force-dynamic";

type Feedback = {
  id: string;
  event_slug: string;
  event_name: string | null;
  note: string | null;
  submitter_role: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  created_at: string;
};

async function loadPending(): Promise<Feedback[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("event_feedback")
    .select(
      "id, event_slug, event_name, note, submitter_role, submitter_name, submitter_email, created_at"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data as Feedback[] | null) ?? [];
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function FeedbackAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error, flash } = readFlash(await searchParams);
  const items = await loadPending();

  return (
    <QueueShell
      title="Event feedback"
      intro={
        <>
          Corrections sent from event pages via &ldquo;Suggest a fix.&rdquo; Apply the change to the
          event the usual way, then mark it resolved, or dismiss it.
        </>
      }
      error={error}
      flash={flash}
    >
      {items.length === 0 ? (
        <EmptyCard
          heading="No pending feedback."
          sub={<>When someone uses &ldquo;Suggest a fix&rdquo; on an event page, it shows up here.</>}
        />
      ) : (
        <CardList>
          {items.map((f) => (
            <FeedbackCard key={f.id} f={f} />
          ))}
        </CardList>
      )}
    </QueueShell>
  );
}

function FeedbackCard({ f }: { f: Feedback }) {
  const isOrganizer = f.submitter_role === "organizer";
  const roleLabel = isOrganizer
    ? "organizer"
    : f.submitter_role === "visitor"
      ? "visitor"
      : "role n/a";
  return (
    <QueueCard accent={isOrganizer ? INK : ACCENT}>
      <CardHeader
        title={f.event_name || f.event_slug}
        meta={
          <>
            <strong>{fmtWhen(f.created_at)}</strong>
            {` · ${roleLabel}`}
            {f.submitter_name ? ` · ${f.submitter_name}` : ""}
            {f.submitter_email ? ` (${f.submitter_email})` : ""}
          </>
        }
      />
      <p style={{ margin: "-8px 0 12px" }}>
        <a
          href={`/events/${f.event_slug}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#2d5a3d", fontSize: 14 }}
        >
          View event &#8599;
        </a>
      </p>

      <blockquote
        style={{
          margin: "0 0 14px",
          padding: "12px 14px",
          background: "#faf9f6",
          borderRadius: 8,
          color: "#2d3a22",
          fontSize: 16,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {f.note}
      </blockquote>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <form action={resolveFeedback} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={f.id} />
          <button type="submit" style={adminBtn.primary}>
            Mark resolved
          </button>
        </form>
        <form
          action={dismissFeedback}
          style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 220 }}
        >
          <input type="hidden" name="id" value={f.id} />
          <input
            name="review_note"
            placeholder="Reason (optional)"
            style={{ ...adminInput, flex: 1, minWidth: 140 }}
          />
          <button type="submit" style={adminBtn.danger}>
            Dismiss
          </button>
        </form>
      </div>
    </QueueCard>
  );
}
