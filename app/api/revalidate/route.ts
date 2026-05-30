import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

/**
 * On-demand cache invalidation.
 *
 *   GET /api/revalidate?secret=…                 → revalidate "/"
 *   GET /api/revalidate?secret=…&tag=geocode     → bust a cache tag
 *   GET /api/revalidate?secret=…&path=/events/x  → revalidate one path
 *
 * `tag` and `path` may each be repeated. After a venue/address backfill the
 * scripts call this with tag=geocode (so pages re-geocode) plus the changed
 * event paths (so they re-render immediately instead of waiting out ISR).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  if (sp.get("secret") !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ message: "Invalid secret" }, { status: 401 });
  }

  const tags = sp.getAll("tag");
  const paths = sp.getAll("path");

  // Next 16: revalidateTag requires a cache profile ("max" = fully invalidate).
  for (const tag of tags) revalidateTag(tag, "max");
  for (const path of paths) revalidatePath(path);

  // The shared upcoming-events cache (lib/events-data.ts) is keyed by the
  // "events" tag. revalidatePath alone won't bust it, so always invalidate the
  // tag too — this keeps existing scraper/backfill callers (which hit this
  // endpoint after writes) refreshing event data after the caching change.
  revalidateTag("events", "max");

  // Default behavior (no params): refresh the homepage list.
  if (tags.length === 0 && paths.length === 0) revalidatePath("/");

  return NextResponse.json({ revalidated: true, tags, paths, now: Date.now() });
}
