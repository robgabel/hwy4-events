import { getLastScrapedAt } from "@/lib/events-data";
import { formatDistanceToNow, parseISO, format } from "date-fns";

export default async function LastChecked() {
  // Derived from the site-wide cached events set — no dedicated query.
  const lastScrapedAt = await getLastScrapedAt();

  if (!lastScrapedAt) {
    return (
      <p className="mt-5 text-sm text-stone">
        Updated regularly. Not all events may be listed.
      </p>
    );
  }

  const date = parseISO(lastScrapedAt);
  const relative = formatDistanceToNow(date, { addSuffix: true });
  const day = format(date, "EEEE");
  const isRecent = Date.now() - date.getTime() < 2 * 24 * 60 * 60 * 1000;

  return (
    <p className="mt-5 text-sm text-stone">
      Last checked {isRecent ? relative : `on ${day}`}. Not all events may be
      listed.
    </p>
  );
}
