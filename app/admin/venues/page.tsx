import { getAdminClientOrNull } from "@/lib/admin/db";
import { readFlash, type SearchParams } from "@/lib/admin/flash";
import {
  QueueShell,
  CardList,
  QueueCard,
  CardHeader,
  EmptyCard,
  adminBtn,
  adminInput,
  ADMIN_MAX_WIDTH,
  INK,
  MUTED,
  SUBTLE,
  ACCENT,
  BORDER,
  SUBTLE_BG,
} from "@/components/admin/ui";
import { PulseTabs } from "@/components/admin/PulseTabs";
import { ConfirmSubmit } from "@/components/admin/ConfirmSubmit";
import { saveBlurb, clearBlurb, discardDraft, saveAddress, discardAddressDraft } from "./actions";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

type AddressDraftMeta = {
  confidence?: "high" | "medium" | "low";
  notes?: string | null;
  sources?: { title?: string; url: string }[];
};

type VenueRow = {
  venue_key: string;
  canonical: string;
  town: string;
  address: string | null;
  address_draft: string | null;
  address_draft_at: string | null;
  address_draft_meta: AddressDraftMeta | null;
  blurb: string | null;
  blurb_generated_at: string | null;
  blurb_draft: string | null;
  blurb_draft_at: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  places_attributes: Record<string, unknown> | null;
  places_synced_at: string | null;
  places_locked: boolean | null;
};

const COLUMNS =
  "venue_key, canonical, town, address, address_draft, address_draft_at, address_draft_meta, blurb, blurb_generated_at, blurb_draft, blurb_draft_at, rating, user_ratings_total, phone, website, maps_url, places_attributes, places_synced_at, places_locked";

// Order by where the work is: anything with a pending AI suggestion (a blurb draft
// or an address suggestion — one click to approve) first, then venues still missing
// a blurb or address (write/fill from scratch), then fully-done venues. Alphabetical
// within each band.
function workRank(v: VenueRow): number {
  const hasSuggestion = (!v.blurb && v.blurb_draft) || (!v.address && v.address_draft);
  if (hasSuggestion) return 0;
  if (!v.blurb || !v.address) return 1;
  return 2;
}

// A scripts/lib/venues.ts KNOWN_VENUES entry to paste + commit, so an approved
// address survives a registry re-seed (the matcher is registry-driven). Seeds a
// single alias from the lowercased canonical; add spelling/variant aliases by hand.
function venuesTsSnippet(v: { venue_key: string; canonical: string; town: string; address: string }): string {
  return `  ${JSON.stringify(v.venue_key)}: {
    canonical: ${JSON.stringify(v.canonical)},
    aliases: [
      ${JSON.stringify(v.canonical.toLowerCase())},
      // add common spellings / variants here
    ],
    town: ${JSON.stringify(v.town)},
    address: ${JSON.stringify(v.address)},
  },`;
}

async function loadVenues(): Promise<VenueRow[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase.from("hwy4_venues").select(COLUMNS);
  const rows = (data ?? []) as VenueRow[];
  return rows.sort(
    (a, b) => workRank(a) - workRank(b) || a.canonical.localeCompare(b.canonical)
  );
}

// places_attributes boolean keys -> short human chips. Only true values render.
const ATTR_LABELS: Record<string, string> = {
  allows_dogs: "dog-friendly",
  good_for_children: "kid-friendly",
  good_for_groups: "good for groups",
  outdoor_seating: "patio",
  serves_beer: "beer",
  serves_wine: "wine",
  serves_cocktails: "cocktails",
  live_music: "live music",
  menu_for_children: "kids menu",
  restroom: "restroom",
  reservable: "reservations",
};

function attrChips(attrs: Record<string, unknown> | null): string[] {
  if (!attrs) return [];
  const chips: string[] = [];
  if (typeof attrs.primary_type === "string") chips.push(attrs.primary_type);
  for (const [key, label] of Object.entries(ATTR_LABELS)) {
    if (attrs[key] === true) chips.push(label);
  }
  if (Array.isArray(attrs.parking) && attrs.parking.length > 0) chips.push("parking");
  return chips;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function VenuesAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error, flash } = readFlash(await searchParams);
  const venues = await loadVenues();
  const withBlurb = venues.filter((v) => v.blurb).length;
  const withDraft = venues.filter((v) => !v.blurb && v.blurb_draft).length;
  const addrSuggested = venues.filter((v) => !v.address && v.address_draft).length;

  return (
    <>
      <div style={{ maxWidth: ADMIN_MAX_WIDTH, margin: "0 auto" }}>
        <PulseTabs active="venues" />
      </div>
      <QueueShell
        title="Venues"
        intro={
        <>
          The local-voice blurb and street address shown on every event&rsquo;s detail page for that
          venue. Google facts (rating, hours, attributes) sync automatically; the blurb is written in
          our voice, and both the blurb and the address are auto-suggested for any venue missing one
          (a daily job researches the address, a daily job drafts the blurb) and edited here.{" "}
          {withBlurb} of {venues.length} venues have a blurb.{" "}
          {withDraft > 0 && (
            <>
              <strong>
                {withDraft} AI blurb draft{withDraft === 1 ? "" : "s"}
              </strong>{" "}
              waiting for review.{" "}
            </>
          )}
          {addrSuggested > 0 && (
            <>
              <strong>
                {addrSuggested} suggested address{addrSuggested === 1 ? "" : "es"}
              </strong>{" "}
              waiting for review.{" "}
            </>
          )}
          A suggestion is never shown publicly until you Save it.
        </>
      }
      error={error}
      flash={flash}
    >
      {venues.length === 0 ? (
        <EmptyCard heading="No venues." sub="The hwy4_venues registry is empty or the DB env is missing." />
      ) : (
        <CardList>
          {venues.map((v) => (
            <VenueBlurbCard key={v.venue_key} venue={v} />
          ))}
        </CardList>
      )}
      </QueueShell>
    </>
  );
}

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 120,
  padding: "10px 12px",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  fontSize: 16,
  lineHeight: 1.55,
  color: INK,
  background: "#fff",
  boxSizing: "border-box",
  resize: "vertical",
  fontFamily: "inherit",
};

const snippetPre: CSSProperties = {
  fontSize: 12,
  color: "#333",
  background: "#FDF8F3",
  border: "1px solid #E7E0D5",
  padding: 12,
  borderRadius: 8,
  overflow: "auto",
  margin: "8px 0 0",
  lineHeight: 1.5,
};

// The street-address surface for a venue card. Three states:
//  - published address  → confirm line + a collapsible venues.ts snippet to commit
//  - no address + AI suggestion (address_draft) → review banner + editable field +
//    Save/Discard + a snippet preview built from the suggested address
//  - no address, none suggested yet → muted hint + a manual entry field
// A human Save is the only path that writes the live `address` column.
function AddressSection({ venue }: { venue: VenueRow }) {
  const hasAddress = Boolean(venue.address);
  const hasSuggestion = !hasAddress && Boolean(venue.address_draft);
  const suggested = venue.address_draft ?? "";
  const meta = venue.address_draft_meta;
  const snippetAddress = venue.address ?? suggested;

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 12,
        background: hasSuggestion ? "#fff7ed" : SUBTLE_BG,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 6 }}>
        📍 Street address{" "}
        {hasAddress ? (
          <span style={{ fontWeight: 400, color: MUTED }}>· set</span>
        ) : hasSuggestion ? (
          <span style={{ fontWeight: 400, color: ACCENT }}>· AI suggestion, not yet applied</span>
        ) : (
          <span style={{ fontWeight: 400, color: SUBTLE }}>· missing</span>
        )}
      </div>

      {hasSuggestion && (
        <div style={{ fontSize: 13, color: INK, lineHeight: 1.5, marginBottom: 8 }}>
          The daily address scan researched this from the web. Verify it before applying (a wrong
          address drops the map pin in the wrong place).
          {meta?.confidence && (
            <>
              {" "}
              Confidence: <strong>{meta.confidence}</strong>.
            </>
          )}
          {meta?.sources && meta.sources.length > 0 && (
            <>
              {" "}
              Sources:{" "}
              {meta.sources.slice(0, 3).map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ", "}
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: INK }}>
                    {hostname(s.url)} ↗
                  </a>
                </span>
              ))}
            </>
          )}
        </div>
      )}

      {!hasAddress && !hasSuggestion && (
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 8 }}>
          No street address yet. The daily venue scan will research and suggest one, or enter it here.
        </div>
      )}

      <form action={saveAddress} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input type="hidden" name="venue_key" value={venue.venue_key} />
        <input
          name="address"
          defaultValue={venue.address ?? suggested}
          placeholder="1154 Pennsylvania Gulch Rd, Murphys, CA 95247"
          style={{ ...adminInput, flex: 1, minWidth: 240 }}
        />
        <button type="submit" style={adminBtn.primary}>
          {hasSuggestion ? "Apply address" : "Save address"}
        </button>
        {hasSuggestion && (
          <button type="submit" formAction={discardAddressDraft} formNoValidate style={adminBtn.danger}>
            Discard
          </button>
        )}
      </form>

      {snippetAddress && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: INK }}>
            Registry snippet for scripts/lib/venues.ts (commit so it survives a re-seed)
          </summary>
          <pre style={snippetPre}>
            {venuesTsSnippet({
              venue_key: venue.venue_key,
              canonical: venue.canonical,
              town: venue.town,
              address: snippetAddress,
            })}
          </pre>
        </details>
      )}
    </div>
  );
}

function VenueBlurbCard({ venue }: { venue: VenueRow }) {
  const hasBlurb = Boolean(venue.blurb);
  // A machine-queued draft awaiting review (only when there's no published blurb).
  const hasDraft = !hasBlurb && Boolean(venue.blurb_draft);
  const chips = attrChips(venue.places_attributes);

  return (
    <QueueCard accent={hasBlurb ? INK : ACCENT}>
      <CardHeader
        title={venue.canonical}
        meta={
          <>
            {venue.town}
            {" · "}
            <code style={{ fontSize: 13, color: SUBTLE }}>{venue.venue_key}</code>
            {venue.places_locked ? " · 🔒 places-locked" : ""}
          </>
        }
      />

      {/* Google facts — context for writing/verifying the blurb (not edited here) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "4px 14px",
          fontSize: 14,
          color: MUTED,
          marginBottom: 10,
        }}
      >
        {venue.rating != null && (
          <span>
            <span style={{ color: ACCENT }}>★</span> {venue.rating.toFixed(1)}
            {venue.user_ratings_total != null && ` (${venue.user_ratings_total.toLocaleString()})`}
          </span>
        )}
        {venue.address && <span>{venue.address}</span>}
        {venue.phone && <span>{venue.phone}</span>}
        {venue.website && (
          <a href={venue.website} target="_blank" rel="noopener noreferrer" style={{ color: INK }}>
            {hostname(venue.website)} ↗
          </a>
        )}
        {venue.maps_url && (
          <a href={venue.maps_url} target="_blank" rel="noopener noreferrer" style={{ color: INK }}>
            Maps ↗
          </a>
        )}
        <span style={{ color: SUBTLE, fontSize: 13 }}>
          facts synced {fmtWhen(venue.places_synced_at)}
        </span>
      </div>

      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {chips.map((c) => (
            <span
              key={c}
              style={{
                fontSize: 13,
                color: INK,
                background: SUBTLE_BG,
                border: `1px solid ${BORDER}`,
                borderRadius: 999,
                padding: "2px 10px",
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      <AddressSection venue={venue} />

      {hasDraft && (
        <div
          style={{
            background: "#fff7ed",
            border: `1px solid ${ACCENT}`,
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 10,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: INK,
          }}
        >
          <strong style={{ color: ACCENT }}>AI draft, not yet published.</strong> Grounded in the
          Google attributes above plus the local knowledge base. Sanity-check any owner names or dish
          specifics (those are review-sourced and lower-confidence). Edit as needed, then Save to
          publish; or Discard.
        </div>
      )}

      <form action={saveBlurb}>
        <input type="hidden" name="venue_key" value={venue.venue_key} />
        <textarea
          name="blurb"
          defaultValue={venue.blurb ?? venue.blurb_draft ?? ""}
          placeholder="No blurb yet — write one in the site's neighbor voice (no em dashes; don't invent hours or names you can't verify)."
          style={textareaStyle}
        />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            marginTop: 10,
          }}
        >
          <button type="submit" style={adminBtn.primary}>
            {hasDraft ? "Publish blurb" : "Save blurb"}
          </button>
          <span style={{ color: SUBTLE, fontSize: 13 }}>
            {hasBlurb
              ? `Last saved ${fmtWhen(venue.blurb_generated_at)}`
              : hasDraft
                ? `AI-drafted ${fmtWhen(venue.blurb_draft_at)}`
                : "Not written yet"}
          </span>
        </div>
      </form>

      {hasDraft && (
        <form action={discardDraft} style={{ marginTop: 8 }}>
          <input type="hidden" name="venue_key" value={venue.venue_key} />
          <ConfirmSubmit
            message={`Discard the AI draft for ${venue.canonical}? The venue stays unblurbed and it won't be re-drafted automatically (write one by hand any time).`}
            style={adminBtn.danger}
          >
            Discard draft
          </ConfirmSubmit>
        </form>
      )}

      {hasBlurb && (
        <form action={clearBlurb} style={{ marginTop: 8 }}>
          <input type="hidden" name="venue_key" value={venue.venue_key} />
          <ConfirmSubmit
            message={`Clear the blurb for ${venue.canonical}? The venue section will hide until you write a new one (the Google facts strip stays).`}
            style={adminBtn.danger}
          >
            Clear blurb
          </ConfirmSubmit>
        </form>
      )}
    </QueueCard>
  );
}
