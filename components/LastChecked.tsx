import { supabase } from "@/lib/supabase";
import { formatDistanceToNow, parseISO, format } from "date-fns";

export default async function LastChecked() {
  const { data } = await supabase
    .from("hwy4_events")
    .select("last_scraped_at")
    .not("last_scraped_at", "is", null)
    .order("last_scraped_at", { ascending: false })
    .limit(1)
    .single();

  if (!data?.last_scraped_at) {
    return (
      <p className="mt-5 text-xs text-stone-light">
        Updated regularly. Not all events may be listed.
      </p>
    );
  }

  const date = parseISO(data.last_scraped_at);
  const relative = formatDistanceToNow(date, { addSuffix: true });
  const day = format(date, "EEEE");
  const isRecent = Date.now() - date.getTime() < 2 * 24 * 60 * 60 * 1000;

  return (
    <p className="mt-5 text-xs text-stone-light">
      Last checked {isRecent ? relative : `on ${day}`}. Not all events may be
      listed.
    </p>
  );
}
