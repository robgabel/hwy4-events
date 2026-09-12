import type { Hwy4Artist } from "@/lib/types";
import {
  ARTIST_LINK_LABELS,
  hasPublishedFields,
  publishedLinkEntries,
} from "@/lib/artists";
import { isHttpUrl } from "@/lib/url";

/**
 * Band context on a live-music event detail page: published genre chip,
 * local-voice blurb, and outbound links. Sibling to VenueInfo.
 *
 * Renders nothing when the artist has no published fields (Tier C). Never
 * accepts or displays blurb_draft* — the public type does not include them.
 * Gate the mount to category==='live_music'; this component also no-ops on
 * an empty/unpublished row so a missed gate stays blank.
 */
export default function ArtistInfo({ artist }: { artist: Hwy4Artist }) {
  if (!hasPublishedFields(artist)) return null;

  const links = publishedLinkEntries(artist.links).filter(([, url]) =>
    isHttpUrl(url)
  );

  return (
    <section className="mb-6">
      <h2 className="font-display mb-2 text-lg font-semibold text-forest">
        About {artist.name}
      </h2>

      {(artist.genre || artist.is_local || artist.hometown) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {artist.genre && (
            <span className="inline-flex items-center rounded-full bg-sunset/8 px-2.5 py-0.5 text-xs font-medium text-earth ring-1 ring-inset ring-sunset/20">
              {artist.genre}
            </span>
          )}
          {artist.is_local && (
            <span className="inline-flex items-center rounded-full bg-pine/10 px-2.5 py-0.5 text-xs font-medium text-pine ring-1 ring-inset ring-pine/20">
              Local
            </span>
          )}
          {artist.hometown && (
            <span className="text-sm text-stone">{artist.hometown}</span>
          )}
        </div>
      )}

      {artist.blurb && (
        <p className="leading-relaxed text-stone">{artist.blurb}</p>
      )}

      {links.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {links.map(([kind, url]) => (
            <a
              key={kind}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-pine hover:underline"
            >
              {ARTIST_LINK_LABELS[kind]}
              <span aria-hidden="true"> ↗</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
