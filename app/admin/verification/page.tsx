import { generateEventSlug } from "@/lib/slugs";
import { getAdminClientOrNull } from "@/lib/admin/db";
import { readFlash, type SearchParams } from "@/lib/admin/flash";
import {
  QueueShell,
  CardList,
  QueueCard,
  EmptyCard,
  CardHeader,
  LinkBox,
  adminBtn,
} from "@/components/admin/ui";
import { ConfirmSubmit } from "@/components/admin/ConfirmSubmit";
import { confirmEvent, dismissEvent, hideEvent, deleteEvent } from "./actions";

export const dynamic = "force-dynamic";

type FlaggedEvent = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  venue_name: string;
  town: string;
  description: string | null;
  source_url: string;
  source_name: string | null;
  event_url: string | null;
  org_slug: string | null;
  verification_reason: string | null;
  verification_snapshot: string | null;
  verification_checked_at: string | null;
};

type OrgRow = {
  slug: string;
  display_name: string;
  canonical_url: string | null;
};

async function loadData(): Promise<{ events: FlaggedEvent[]; orgs: Map<string, OrgRow> }> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return { events: [], orgs: new Map() };

  const { data: events } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, date, start_time, venue_name, town, description, source_url, source_name, event_url, org_slug, verification_reason, verification_snapshot, verification_checked_at"
    )
    .eq("verification_status", "needs_verification")
    .order("date", { ascending: true });

  const { data: orgs } = await supabase
    .from("hwy4_orgs")
    .select("slug, display_name, canonical_url");

  const orgMap = new Map<string, OrgRow>();
  for (const o of (orgs ?? []) as OrgRow[]) orgMap.set(o.slug, o);

  return { events: (events ?? []) as FlaggedEvent[], orgs: orgMap };
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return ` · ${display}:${m} ${ampm}`;
}

function fmtChecked(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function VerificationAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error, flash } = readFlash(await searchParams);
  const { events, orgs } = await loadData();

  return (
    <QueueShell
      title="Event verification queue"
      intro={
        <>
          Events whose dates didn&rsquo;t match the organizer&rsquo;s canonical events page. Confirm
          the ones that are fine, dismiss false positives, hide or delete the rest.
        </>
      }
      error={error}
      flash={flash}
    >
      {events.length === 0 ? (
        <EmptyCard heading="All clear." sub="No events are currently flagged for verification." />
      ) : (
        <CardList>
          {events.map((ev) => (
            <FlaggedEventRow key={ev.id} event={ev} orgs={orgs} />
          ))}
        </CardList>
      )}
    </QueueShell>
  );
}

function FlaggedEventRow({ event, orgs }: { event: FlaggedEvent; orgs: Map<string, OrgRow> }) {
  const org = event.org_slug ? orgs.get(event.org_slug) : undefined;

  return (
    <QueueCard>
      <CardHeader
        title={event.name}
        meta={
          <>
            <strong>{fmtDate(event.date)}</strong>
            {fmtTime(event.start_time)} · {event.venue_name}, {event.town}
          </>
        }
      />

      {event.description && (
        <p style={{ color: "#3a3a3a", fontSize: 15, lineHeight: 1.55, margin: "0 0 12px" }}>
          {event.description}
        </p>
      )}

      <div
        style={{
          background: "#fff7ed",
          border: "1px solid #fde4c8",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 12,
        }}
      >
        <p
          style={{
            color: "#9a3412",
            fontSize: 13,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 4px",
          }}
        >
          Why flagged
        </p>
        <p style={{ color: "#3a3a3a", fontSize: 15, lineHeight: 1.5, margin: 0 }}>
          {event.verification_reason ?? "No reason recorded."}
        </p>
        <p style={{ color: "#999", fontSize: 13, margin: "6px 0 0" }}>
          Checked {fmtChecked(event.verification_checked_at)}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
          marginBottom: 14,
          fontSize: 15,
        }}
      >
        <LinkBox
          label="Event page"
          href={`/events/${generateEventSlug(event.name, event.date, event.town)}`}
          note="View on site"
        />
        <LinkBox label="Source" href={event.source_url} note={event.source_name ?? "Where scraped"} external />
        {org?.canonical_url && (
          <LinkBox label="Organizer canonical" href={org.canonical_url} note={org.display_name} external />
        )}
        {event.event_url && (
          <LinkBox label="Event URL" href={event.event_url} note="Direct event link" external />
        )}
      </div>

      {event.verification_snapshot && (
        <details style={{ marginBottom: 14 }}>
          <summary style={{ fontSize: 14, color: "#666", cursor: "pointer", userSelect: "none" }}>
            Canonical page snapshot ({event.verification_snapshot.length.toLocaleString()} chars)
          </summary>
          <pre
            style={{
              background: "#FDF8F3",
              border: "1px solid #E7E0D5",
              borderRadius: 6,
              padding: 10,
              marginTop: 8,
              fontSize: 13,
              lineHeight: 1.5,
              color: "#555",
              maxHeight: 240,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {event.verification_snapshot}
          </pre>
        </details>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <form action={confirmEvent} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={event.id} />
          <button type="submit" style={adminBtn.primary}>
            Confirm date
          </button>
        </form>
        <form action={dismissEvent} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={event.id} />
          <button type="submit" style={adminBtn.secondary}>
            Dismiss flag
          </button>
        </form>
        <form action={hideEvent} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={event.id} />
          <button type="submit" style={adminBtn.secondary}>
            Hide event
          </button>
        </form>
        <form action={deleteEvent} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={event.id} />
          <ConfirmSubmit
            message={`Delete "${event.name}" permanently? This cannot be undone.`}
            style={adminBtn.danger}
          >
            Delete event
          </ConfirmSubmit>
        </form>
      </div>
    </QueueCard>
  );
}
