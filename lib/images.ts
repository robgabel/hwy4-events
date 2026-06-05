// Image-source safety classifier — the ONE place that decides whether an image
// src may go through `next/image`.
//
// `next/image` validates a remote `src`'s hostname against the allowlist in
// `next.config.ts` *at render time* and THROWS for any host that isn't listed.
// Event posters (`hwy4_events.image_url`) come from unbounded sources — scraped
// venue sites, organizer swaps in our Supabase Storage bucket, community
// submissions — so their hosts can't all be enumerated in the config. Handing
// one to `<Image>` 500s whatever page renders it. On the homepage that's
// especially nasty: it serves under hourly ISR, so a single bad poster freezes
// the cached page and new events silently stop surfacing until the row is fixed
// (this bit us live with a calaverashumane.org poster).
//
// The pattern already used at the event detail hero, the submit-poster preview,
// and the admin poster review: render LOCAL bundled assets through `next/image`
// (optimized) and REMOTE URLs through a plain `<img>`, which has no host
// allowlist and so can never throw.
//
// "Local" = a same-origin public asset referenced by an absolute path
// (`/images/live_music.svg`). Protocol-relative (`//host/x.jpg`) and absolute
// URLs (`https://…`, `http://…`) are remote. Anything that isn't a clean local
// path is treated as remote, i.e. routed to the safe `<img>` fallback.
export function isLocalImage(src: string): boolean {
  return src.startsWith("/") && !src.startsWith("//");
}
