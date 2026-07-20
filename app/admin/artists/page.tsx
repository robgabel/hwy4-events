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
import { saveArtist, clearArtist, discardArtistDraft } from "./actions";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

type ArtistLinks = {
  website?: string;
  facebook?: string;
  spotify?: string;
  bandcamp?: string;
  instagram?: string;
};

type DraftMeta = {
  confidence?: "high" | "medium" | "low";
  genre?: string | null;
  hometown?: string | null;
  is_local?: boolean;
  links?: ArtistLinks;
  notes?: string | null;
  sources?: { title?: string; url: string }[];
};

type ArtistRow = {
  artist_key: string;
  name: string;
  genre: string | null;
  blurb: string | null;
  blurb_generated_at: string | null;
  blurb_draft: string | null;
  blurb_draft_at: string | null;
  blurb_draft_meta: DraftMeta | null;
  links: ArtistLinks | null;
  hometown: string | null;
  is_local: boolean | null;
};

const COLUMNS =
  "artist_key, name, genre, blurb, blurb_generated_at, blurb_draft, blurb_draft_at, blurb_draft_meta, links, hometown, is_local";

function linkCount(l: ArtistLinks | null | undefined): number {
  return l ? Object.values(l).filter(Boolean).length : 0;
}

function isPublished(v: ArtistRow): boolean {
  return Boolean(v.blurb || v.genre || linkCount(v.links) > 0);
}

// A row is "reviewable" when it isn't published yet but the drafter found SOMETHING
// worth a human click — draft prose, a genre, or at least a link to publish. A
// tried-and-empty row (drafter looked, found nothing) is not reviewable.
function isReviewable(v: ArtistRow): boolean {
  if (isPublished(v)) return false;
  const m = v.blurb_draft_meta;
  return Boolean(v.blurb_draft || m?.genre || linkCount(m?.links) > 0);
}

// Order by where the work is: reviewable drafts first, then published, then
// tried-empty. Alphabetical within each band.
function workRank(v: ArtistRow): number {
  if (isReviewable(v)) return 0;
  if (isPublished(v)) return 1;
  return 2;
}

async function loadArtists(): Promise<ArtistRow[]> {
  const supabase = getAdminClientOrNull();
  if (!supabase) return [];
  const { data } = await supabase.from("hwy4_artists").select(COLUMNS);
  const rows = (data ?? []) as ArtistRow[];
  return rows.sort((a, b) => workRank(a) - workRank(b) || a.name.localeCompare(b.name));
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
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const LINK_ORDER: (keyof ArtistLinks)[] = ["website", "facebook", "spotify", "bandcamp", "instagram"];

function LinkChips({ links }: { links: ArtistLinks | null | undefined }) {
  if (!links) return null;
  const present = LINK_ORDER.filter((k) => links[k]);
  if (present.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      {present.map((k) => (
        <a
          key={k}
          href={links[k]}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 13,
            color: INK,
            background: SUBTLE_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 999,
            padding: "2px 10px",
            textDecoration: "none",
          }}
        >
          {k} · {hostname(links[k]!)} ↗
        </a>
      ))}
    </div>
  );
}

export default async function ArtistsAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { error, flash } = readFlash(await searchParams);
  const artists = await loadArtists();
  const published = artists.filter(isPublished).length;
  const reviewable = artists.filter(isReviewable).length;

  return (
    <>
      <div style={{ maxWidth: ADMIN_MAX_WIDTH, margin: "0 auto" }}>
        <PulseTabs active="artists" />
      </div>
      <QueueShell
        title="Artists"
        intro={
          <>
            A short genre tag, a two-sentence local-voice blurb, and outbound links (website /
            Facebook / Spotify) for the bands playing live music, drafted the same way venue blurbs
            are. A daily job researches each upcoming act and stages a suggestion here; the machine
            errs on the side of nothing when it can&rsquo;t confidently identify one act, because a
            wrong band&rsquo;s bio is worse than a blank.{" "}
            {published} of {artists.length} acts published.{" "}
            {reviewable > 0 && (
              <>
                <strong>
                  {reviewable} suggestion{reviewable === 1 ? "" : "s"}
                </strong>{" "}
                waiting for review.{" "}
              </>
            )}
            Nothing is shown publicly until you Save it.
          </>
        }
        error={error}
        flash={flash}
      >
        {artists.length === 0 ? (
          <EmptyCard
            heading="No acts yet."
            sub="The daily drafter (/api/agent/draft-artist-blurbs) fills this from upcoming live-music events, or the DB env is missing."
          />
        ) : (
          <CardList>
            {artists.map((a) => (
              <ArtistCard key={a.artist_key} artist={a} />
            ))}
          </CardList>
        )}
      </QueueShell>
    </>
  );
}

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: 96,
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

function ArtistCard({ artist: a }: { artist: ArtistRow }) {
  const published = isPublished(a);
  const reviewable = isReviewable(a);
  const empty = !published && !reviewable;
  const meta = a.blurb_draft_meta;
  // Links to show: the published set, or (pre-publish) the researched draft set.
  const links = linkCount(a.links) > 0 ? a.links : meta?.links ?? null;

  return (
    <QueueCard accent={published ? INK : reviewable ? ACCENT : SUBTLE}>
      <CardHeader
        title={a.name}
        meta={
          <>
            {a.hometown ? `${a.hometown} · ` : ""}
            {(a.is_local || meta?.is_local) && (
              <span style={{ color: ACCENT, fontWeight: 600 }}>local · </span>
            )}
            <code style={{ fontSize: 13, color: SUBTLE }}>{a.artist_key}</code>
          </>
        }
      />

      <LinkChips links={links} />

      {reviewable && (
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
          <strong style={{ color: ACCENT }}>AI suggestion, not yet published.</strong> Researched from
          the web. Confirm it&rsquo;s the right act before publishing (some band names match several
          groups).
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
              {meta.sources.slice(0, 4).map((s, i) => (
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

      {empty && (
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 10 }}>
          Researched {fmtWhen(a.blurb_draft_at)}, nothing confidently found. Won&rsquo;t be
          re-researched automatically. Fill in a genre / blurb / links by hand if you know this act.
        </div>
      )}

      <form action={saveArtist}>
        <input type="hidden" name="artist_key" value={a.artist_key} />
        <div style={{ marginBottom: 8 }}>
          <input
            name="genre"
            defaultValue={a.genre ?? meta?.genre ?? ""}
            placeholder="Genre (e.g. Classic rock covers, Americana) — leave blank if unsure"
            style={{ ...adminInput, width: "100%", boxSizing: "border-box" }}
          />
        </div>
        <textarea
          name="blurb"
          defaultValue={a.blurb ?? a.blurb_draft ?? ""}
          placeholder="No blurb — leave empty unless you can describe them accurately (no em dashes; don't invent their sound)."
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
            {reviewable ? "Publish" : "Save"}
          </button>
          <span style={{ color: SUBTLE, fontSize: 13 }}>
            {published
              ? `Published ${fmtWhen(a.blurb_generated_at ?? a.blurb_draft_at)}`
              : reviewable
                ? `AI-drafted ${fmtWhen(a.blurb_draft_at)}`
                : "Not published"}
          </span>
        </div>
      </form>

      {reviewable && (
        <form action={discardArtistDraft} style={{ marginTop: 8 }}>
          <input type="hidden" name="artist_key" value={a.artist_key} />
          <ConfirmSubmit
            message={`Discard the AI suggestion for ${a.name}? It won't be re-researched automatically (fill it in by hand any time).`}
            style={adminBtn.danger}
          >
            Discard suggestion
          </ConfirmSubmit>
        </form>
      )}

      {published && (
        <form action={clearArtist} style={{ marginTop: 8 }}>
          <input type="hidden" name="artist_key" value={a.artist_key} />
          <ConfirmSubmit
            message={`Clear everything published for ${a.name}?`}
            style={adminBtn.danger}
          >
            Clear
          </ConfirmSubmit>
        </form>
      )}
    </QueueCard>
  );
}
