/**
 * Generate a URL-friendly slug from event name, date, and town.
 * Example: "Live Music at the Brewery" + "2026-03-15" + "Murphys"
 *       → "live-music-at-the-brewery-2026-03-15-murphys"
 */
export function generateEventSlug(
  name: string,
  date: string,
  town: string
): string {
  const text = `${name} ${date} ${town}`;
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
