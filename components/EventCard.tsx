import { Hwy4Event, CATEGORY_LABELS } from "@/lib/types";
import { format, parseISO } from "date-fns";

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

const ORG_LABELS: Record<string, string> = {
  "moose-lodge": "Moose Lodge",
  "sequoia-woods": "Sequoia Woods",
};

export default function EventCard({ event }: { event: Hwy4Event }) {
  const isPrivate = event.visibility === "private";
  const dateObj = parseISO(event.date);
  const dayOfWeek = format(dateObj, "EEE");
  const monthDay = format(dateObj, "MMM d");

  const startTime = formatTime(event.start_time);
  const endTime = formatTime(event.end_time);
  const timeRange = startTime
    ? endTime
      ? `${startTime} - ${endTime}`
      : startTime
    : null;

  return (
    <article className={`group flex gap-4 rounded-xl border p-4 shadow-sm transition-all hover:shadow-md sm:p-5 ${isPrivate ? "border-l-4 border-l-earth/40 border-t-stone-light/30 border-r-stone-light/30 border-b-stone-light/30 bg-earth/[0.02]" : "border-stone-light/30 bg-white hover:border-sage/50"}`}>
      {/* Date block */}
      <div className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-forest/5 py-2.5">
        <span className="text-xs font-medium uppercase text-pine">
          {dayOfWeek}
        </span>
        <span className="text-lg font-bold text-forest">
          {format(dateObj, "d")}
        </span>
        <span className="text-xs text-stone">{format(dateObj, "MMM")}</span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-2">
          <h3 className="font-semibold text-forest group-hover:text-pine">
            {event.event_url ? (
              <a
                href={event.event_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {event.name}
              </a>
            ) : (
              event.name
            )}
          </h3>
          <span
            className={`badge-${event.category} inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
          >
            {CATEGORY_LABELS[event.category]}
          </span>
          {event.status === "tentative" && (
            <span className="inline-flex items-center rounded-full bg-sunset/10 px-2 py-0.5 text-xs font-medium text-sunset">
              Tentative
            </span>
          )}
          {isPrivate && event.org_slug && (
            <span className="inline-flex items-center gap-1 rounded-full bg-earth/10 px-2 py-0.5 text-xs font-medium text-earth">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {ORG_LABELS[event.org_slug] || event.org_slug}
            </span>
          )}
        </div>

        {event.description && (
          <p className="mt-1.5 line-clamp-2 text-sm text-stone">
            {event.description}
          </p>
        )}

        {/* Artists */}
        {event.artists && event.artists.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {event.artists.map((artist) => (
              <span
                key={artist}
                className="rounded-md bg-sunset/8 px-2 py-0.5 text-xs font-medium text-earth"
              >
                {artist}
              </span>
            ))}
          </div>
        )}

        {/* Meta row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone">
          {/* Location */}
          <span className="flex items-center gap-1">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            {event.venue_name}, {event.town}
          </span>

          {/* Time */}
          {timeRange && (
            <span className="flex items-center gap-1">
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {timeRange}
            </span>
          )}

          {/* Price */}
          {event.price && (
            <span className="flex items-center gap-1">
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {event.price}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
