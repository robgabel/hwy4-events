import { createClient } from "@supabase/supabase-js";
import { generateEventSlug } from "@/lib/slugs";
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { events: [], orgs: new Map() };
  const supabase = createClient(supabaseUrl, serviceKey);

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

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function VerificationAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const errorMsg = typeof params.error === "string" ? params.error : null;
  const flash = typeof params.flash === "string" ? params.flash : null;

  const { events, orgs } = await loadData();

  return (
    <div style={{ maxWidth: 940, margin: "0 auto" }}>
      <h1 style={{ color: "#2d5016", fontSize: 24, margin: "0 0 4px" }}>
        Event verification queue
      </h1>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 24px" }}>
        Events whose dates didn&rsquo;t match the organizer&rsquo;s canonical events page. Confirm
        the ones that are fine, dismiss false positives, hide or delete the rest.
      </p>

      {errorMsg && (
        <div
          style={{
            background: "#fdecea",
            border: "1px solid #f5b7b1",
            color: "#922b21",
            padding: "12px 16px",
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          {errorMsg}
        </div>
      )}
      {flash && (
        <div
          style={{
            background: "#eaf7ea",
            border: "1px solid #b7e0b7",
            color: "#2d5016",
            padding: "12px 16px",
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          {flash}
        </div>
      )}

      {events.length === 0 ? (
        <section
          style={{
            background: "#fff",
            border: "1px solid #e8e4de",
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
          }}
        >
          <p style={{ color: "#2d5016", fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
            All clear.
          </p>
          <p style={{ color: "#666", fontSize: 14, margin: 0 }}>
            No events are currently flagged for verification.
          </p>
        </section>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {events.map((ev) => (
            <FlaggedEventRow key={ev.id} event={ev} orgs={orgs} />
          ))}
        </div>
      )}
    </div>
  );
}

function FlaggedEventRow({
  event,
  orgs,
}: {
  event: FlaggedEvent;
  orgs: Map<string, OrgRow>;
}) {
  const org = event.org_slug ? orgs.get(event.org_slug) : undefined;

  return (
    <article
      style={{
        background: "white",
        border: "1px solid #e8e4de",
        borderLeft: "4px solid #d97706",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ color: "#2d5016", fontSize: 17, margin: "0 0 4px", fontWeight: 600 }}>
          {event.name}
        </h2>
        <p style={{ color: "#666", fontSize: 13, margin: 0 }}>
          <strong>{fmtDate(event.date)}</strong>
          {fmtTime(event.start_time)} · {event.venue_name}, {event.town}
        </p>
      </header>

      {event.description && (
        <p style={{ color: "#3a3a3a", fontSize: 13, lineHeight: 1.55, margin: "0 0 12px" }}>
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
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 4px",
          }}
        >
          Why flagged
        </p>
        <p style={{ color: "#3a3a3a", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          {event.verification_reason ?? "No reason recorded."}
        </p>
        <p style={{ color: "#999", fontSize: 11, margin: "6px 0 0" }}>
          Checked {fmtChecked(event.verification_checked_at)}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
          marginBottom: 14,
          fontSize: 13,
        }}
      >
        <LinkBox
          label="Event page"
          href={`/events/${generateEventSlug(event.name, event.date, event.town)}`}
          note="View on site"
        />
        <LinkBox label="Source" href={event.source_url} note={event.source_name ?? "Where scraped"} external />
        {org?.canonical_url && (
          <LinkBox
            label="Organizer canonical"
            href={org.canonical_url}
            note={org.display_name}
            external
          />
        )}
        {event.event_url && (
          <LinkBox label="Event URL" href={event.event_url} note="Direct event link" external />
        )}
      </div>

      {event.verification_snapshot && (
        <details style={{ marginBottom: 14 }}>
          <summary
            style={{
              fontSize: 12,
              color: "#666",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            Canonical page snapshot ({event.verification_snapshot.length.toLocaleString()} chars)
          </summary>
          <pre
            style={{
              background: "#faf9f6",
              border: "1px solid #e8e4de",
              borderRadius: 6,
              padding: 10,
              marginTop: 8,
              fontSize: 11,
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
          <button type="submit" style={primaryBtnStyle}>
            Confirm date
          </button>
        </form>
        <form action={dismissEvent} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={event.id} />
          <button type="submit" style={secondaryBtnStyle}>
            Dismiss flag
          </button>
        </form>
        <form action={hideEvent} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={event.id} />
          <button type="submit" style={secondaryBtnStyle}>
            Hide event
          </button>
        </form>
        <form action={deleteEvent} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={event.id} />
          <button
            type="submit"
            style={dangerBtnStyle}
            formNoValidate
          >
            Delete event
          </button>
        </form>
      </div>
    </article>
  );
}

function LinkBox({
  label,
  href,
  note,
  external = false,
}: {
  label: string;
  href: string;
  note: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      style={{
        display: "block",
        background: "#faf9f6",
        border: "1px solid #e8e4de",
        borderRadius: 8,
        padding: "8px 12px",
        textDecoration: "none",
        color: "#2d5016",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "#888",
          margin: "0 0 2px",
        }}
      >
        {label} {external && "↗"}
      </p>
      <p
        style={{
          fontSize: 13,
          color: "#2d5016",
          margin: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {note}
      </p>
    </a>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#2d5016",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#faf9f6",
  color: "#2d5016",
  border: "1px solid #2d5016",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#fff",
  color: "#922b21",
  border: "1px solid #e6b8b3",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
