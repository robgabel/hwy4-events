import { generateEventSlug } from "@/lib/slugs";
import { getAdminClientOrNull } from "@/lib/admin/db";
import { readFlash, type SearchParams } from "@/lib/admin/flash";
import {
  QueueShell,
  CardList,
  QueueCard,
  EmptyCard,
  CardHeader,
  INK,
  adminBtn,
  adminInput,
} from "@/components/admin/ui";
import { approvePosterSubmission, rejectPosterSubmission } from "./actions";

export const dynamic = "force-dynamic";

type Submission = {
  id: string;
  event_id: string | null;
  event_slug: string | null;
  image_url: string;
  submitter_name: string | null;
  submitter_email: string | null;
  note: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  name: string;
  date: string;
  town: string;
  image_url: string | null;
};

async function loadData(): Promise<{ submissions: Submission[]; events: Map<string, EventRow> }> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return { submissions: [], events: new Map() };

  const { data } = await supabase
    .from("poster_submissions")
    .select("id, event_id, event_slug, image_url, submitter_name, submitter_email, note, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const submissions = (data as Submission[] | null) ?? [];

  const eventIds = [...new Set(submissions.map((s) => s.event_id).filter(Boolean))] as string[];
  const events = new Map<string, EventRow>();
  if (eventIds.length > 0) {
    const { data: rows } = await supabase
      .from("hwy4_events")
      .select("id, name, date, town, image_url")
      .in("id", eventIds);
    for (const r of (rows as EventRow[] | null) ?? []) events.set(r.id, r);
  }
  return { submissions, events };
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function PostersAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error, flash } = readFlash(await searchParams);
  const { submissions, events } = await loadData();

  return (
    <QueueShell
      title="Poster submissions"
      intro={
        <>
          Posters organizers sent in for their events. Approve to swap the art onto every upcoming
          date of that event (we show it untouched), or dismiss it.
        </>
      }
      error={error}
      flash={flash}
    >
      {submissions.length === 0 ? (
        <EmptyCard
          heading="No pending poster submissions."
          sub="When an organizer uploads their poster from an event page, it shows up here for review."
        />
      ) : (
        <CardList>
          {submissions.map((s) => (
            <SubmissionCard key={s.id} sub={s} event={s.event_id ? events.get(s.event_id) ?? null : null} />
          ))}
        </CardList>
      )}
    </QueueShell>
  );
}

function SubmissionCard({ sub, event }: { sub: Submission; event: EventRow | null }) {
  const slug = event ? generateEventSlug(event.name, event.date, event.town) : sub.event_slug;
  const currentSrc = event?.image_url || (slug ? `/events/${slug}/poster` : null);
  const eventHadOwnPoster = Boolean(event?.image_url);

  return (
    <QueueCard accent={INK}>
      <CardHeader
        title={event ? event.name : sub.event_slug || "Unknown event"}
        meta={
          <>
            {event ? (
              <>
                <strong>{fmtDate(event.date)}</strong> · {event.town}
              </>
            ) : (
              <span style={{ color: "#922b21" }}>Original event not found (may have been removed)</span>
            )}
            {" · "}
            {sub.submitter_name || "anonymous"}
            {sub.submitter_email ? ` (${sub.submitter_email})` : ""}
            {" · "}
            <span style={{ color: "#999" }}>submitted {fmtWhen(sub.created_at)}</span>
          </>
        }
      />
      {sub.note && (
        <p
          style={{
            color: "#444",
            fontSize: 15,
            margin: "-4px 0 14px",
            padding: "8px 12px",
            background: "#FDF8F3",
            borderRadius: 8,
            borderLeft: "3px solid #d9d4cc",
          }}
        >
          “{sub.note}”
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
          alignItems: "start",
        }}
      >
        <Poster
          label={eventHadOwnPoster ? "On the page now (organizer)" : "On the page now (generated)"}
          src={currentSrc}
        />
        <Poster label="Submitted" src={sub.image_url} highlight />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <form action={approvePosterSubmission} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="hidden" name="id" value={sub.id} />
          <button type="submit" style={adminBtn.primary} disabled={!event}>
            Approve &amp; swap in
          </button>
        </form>
        <span style={{ fontSize: 14, color: "#999" }}>Applies to all upcoming dates of this event.</span>
      </div>

      <form
        action={rejectPosterSubmission}
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid #f0ede8",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input type="hidden" name="id" value={sub.id} />
        <input name="review_note" placeholder="Reason (optional)" style={{ ...adminInput, flex: 1, minWidth: 180 }} />
        <button type="submit" style={adminBtn.danger}>
          Dismiss
        </button>
      </form>
    </QueueCard>
  );
}

function Poster({ label, src, highlight }: { label: string; src: string | null; highlight?: boolean }) {
  return (
    <div>
      <p
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: highlight ? INK : "#999",
          margin: "0 0 6px",
        }}
      >
        {label}
      </p>
      <div
        style={{
          borderRadius: 10,
          overflow: "hidden",
          background: "#FDF8F3",
          border: highlight ? `2px solid ${INK}` : "1px solid #E7E0D5",
          aspectRatio: "4 / 5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <span style={{ color: "#bbb", fontSize: 14 }}>No poster</span>
        )}
      </div>
    </div>
  );
}
