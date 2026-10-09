"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { generateEventSlug } from "@/lib/slugs";
import { nowPacificMinutes } from "@/lib/event-time";
import { pacificNow, type DateWindow } from "@/lib/date-windows";
import {
  buildWeekendAnswer,
  nearestTownWithEvents,
  selectWeekendEvents,
  weekdayName,
  weekendEmptyLine,
  type WeekendEvent,
} from "@/lib/town-weekend";

/** Matches the town page: list this many, then hand the rest to /this-weekend. */
const WEEKEND_LIST_CAP = 8;

/**
 * The dated "this weekend" answer on a town page.
 *
 * The page is ISR-cached for an hour. The server passes every public row in
 * the weekend window plus the clock it rendered with, so the first paint
 * matches the cached HTML. After hydration the Pacific clock is read again,
 * and a show that has ended leaves the sentence and the list.
 */
export default function TownWeekendLive({
  town,
  range,
  rows,
  nearestTowns,
  townHrefs,
  serverNowMinutes,
  serverTodayIso,
}: {
  town: string;
  range: DateWindow;
  /** Public weekend rows for the whole corridor. This town is filtered here. */
  rows: WeekendEvent[];
  nearestTowns: string[];
  townHrefs: Record<string, string>;
  serverNowMinutes: number;
  serverTodayIso: string;
}) {
  const [live, setLive] = useState<{ minutes: number; iso: string } | null>(
    null
  );

  useEffect(() => {
    const tick = () => {
      setLive({ minutes: nowPacificMinutes(), iso: pacificNow().iso });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const minutes = live?.minutes ?? serverNowMinutes;
  const todayIso = live?.iso ?? serverTodayIso;

  const selected = useMemo(
    () => selectWeekendEvents(rows, town, range, minutes),
    [rows, town, range, minutes]
  );
  const answer = buildWeekendAnswer(town, selected);
  const fallback = answer
    ? null
    : nearestTownWithEvents(nearestTowns, rows, range, minutes);

  if (answer) {
    const shown = selected.slice(0, WEEKEND_LIST_CAP);
    return (
      <>
        <p className="speakable leading-relaxed text-stone">{answer}</p>
        <ul className="mt-3 space-y-1 text-sm">
          {shown.map((e) => (
            <li key={e.id} className="text-stone">
              <span className="text-stone-light">{weekdayName(e.date)}: </span>
              <Link
                href={`/events/${generateEventSlug(e.name, e.date, e.town)}`}
                className="font-medium text-pine hover:underline"
              >
                {e.name}
              </Link>
            </li>
          ))}
        </ul>
        {selected.length > WEEKEND_LIST_CAP && (
          <p className="mt-2 text-sm">
            <Link href="/this-weekend" className="font-medium text-pine hover:underline">
              See all {selected.length} on the weekend page &rarr;
            </Link>
          </p>
        )}
      </>
    );
  }

  const fallbackHref = fallback
    ? (townHrefs[fallback.town] ??
      `/?town=${encodeURIComponent(fallback.town)}`)
    : null;

  return (
    <p className="speakable leading-relaxed text-stone">
      {weekendEmptyLine(town, range, todayIso)}{" "}
      {fallback && fallbackHref ? (
        <>
          The nearest town with something on is{" "}
          <Link href={fallbackHref} className="font-medium text-pine hover:underline">
            {fallback.town}
          </Link>
          , or see{" "}
        </>
      ) : (
        <>See </>
      )}
      <Link href="/this-weekend" className="font-medium text-pine hover:underline">
        everything on the corridor this weekend
      </Link>
      .
    </p>
  );
}
