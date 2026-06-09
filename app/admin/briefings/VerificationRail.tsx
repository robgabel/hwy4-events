import Link from "next/link";
import { getAdminClientOrNull } from "@/lib/admin/db";
import { INK, MUTED, adminBtn } from "@/components/admin/ui";
import { confirmEvent, dismissEvent } from "@/app/admin/verification/actions";

// The verification action rail on the Today tab. Mirrors the submissions rail:
// events whose scraped date didn't match the organizer's canonical page, with
// the two reversible/internal verbs inline — Confirm (date's fine) and Dismiss
// (false positive). Both are status flips, re-checkable, internal. Hide and
// delete (the destructive verbs) stay on /admin/verification behind a review.

const RETURN_TO = "/admin/briefings";

type FlaggedRow = {
  id: string;
  name: string;
  date: string;
  town: string | null;
  venue_name: string | null;
  verification_reason: string | null;
};

async function loadFlagged(): Promise<FlaggedRow[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase
    .from("hwy4_events")
    .select("id, name, date, town, venue_name, verification_reason")
    .eq("verification_status", "needs_verification")
    .order("date", { ascending: true });
  return (data as FlaggedRow[] | null) ?? [];
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export async function VerificationRail() {
  const rows = await loadFlagged();
  if (rows.length === 0) return null; // the digest narrative covers the all-clear case

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 12px" }}>
        <h2
          style={{
            color: INK,
            fontSize: 15,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            margin: 0,
          }}
        >
          Dates to verify
        </h2>
        <span style={{ color: MUTED, fontSize: 14 }}>
          {rows.length} flagged · scraped date didn&rsquo;t match the organizer
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => (
          <FlaggedRowCard key={r.id} row={r} />
        ))}
      </div>
    </section>
  );
}

function FlaggedRowCard({ row }: { row: FlaggedRow }) {
  return (
    <article
      style={{
        background: "#fff",
        border: "1px solid #E7E0D5",
        borderLeft: "4px solid #C4922A",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <h3 style={{ color: INK, fontSize: 17, margin: "0 0 2px", fontWeight: 600 }}>{row.name}</h3>
        <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>
          <strong>{fmtDate(row.date)}</strong>
          {row.venue_name ? ` · ${row.venue_name}` : ""}
          {row.town ? `, ${row.town}` : ""}
        </p>
        {row.verification_reason && (
          <p style={{ color: "#9a3412", fontSize: 14, lineHeight: 1.5, margin: "6px 0 0" }}>
            {row.verification_reason}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <form action={confirmEvent} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="returnTo" value={RETURN_TO} />
          <button type="submit" style={{ ...adminBtn.primary, padding: "8px 14px", fontSize: 15 }}>
            Confirm date
          </button>
        </form>
        <form action={dismissEvent} style={{ margin: 0 }}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="returnTo" value={RETURN_TO} />
          <button type="submit" style={{ ...adminBtn.secondary, padding: "8px 14px" }}>
            Dismiss flag
          </button>
        </form>
        <Link
          href="/admin/verification"
          style={{
            ...adminBtn.secondary,
            padding: "8px 14px",
            textDecoration: "none",
            display: "inline-block",
            borderColor: "#d9d4cc",
            color: MUTED,
          }}
        >
          Review →
        </Link>
      </div>
    </article>
  );
}
