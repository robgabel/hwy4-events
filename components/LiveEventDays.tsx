"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Hwy4Event } from "@/lib/types";
import type { TownForecasts } from "@/lib/weather";
import { filterListableNow, nowPacificMinutes } from "@/lib/event-time";
import {
  nextWeekendHandoffLead,
  pacificNow,
  shouldOfferNextWeekend,
  type DateWindow,
  type PacificNow,
} from "@/lib/date-windows";
import { formatLongMonthDay, formatLongWeekday, parseDate } from "@/lib/date-utils";
import SimpleEventList from "./SimpleEventList";

/**
 * Day-grouped event list that drops rows once they have ended.
 *
 * These pages are ISR-cached (hourly on the temporal/intent routes, 30 min on
 * /live-music). Filtering only at render would leave a finished 1 PM show on
 * the page until the next regeneration. The server passes rows that were still
 * on at generation time (and builds JSON-LD from that same set). This island
 * re-checks the Pacific clock after mount, the way the homepage does, so a
 * visitor does not wait out the cache. `now` stays null on the server and the
 * first paint so hydration matches the cached HTML; finished rows drop on the
 * next tick.
 */
export type NextWeekendHandoff = {
  href: string;
  dateLabel: string;
  pageRange: DateWindow;
  /** Clock baked at generation, so the first paint matches the cached HTML. */
  serverNow: PacificNow;
  /** Rows in the window before the ended filter. Distinguishes "wrapped up"
   *  from "nothing was ever listed". */
  listedCount: number;
};

function groupByDate(events: Hwy4Event[]): [string, Hwy4Event[]][] {
  const map = new Map<string, Hwy4Event[]>();
  for (const event of events) {
    const arr = map.get(event.date) ?? [];
    arr.push(event);
    map.set(event.date, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function dayHeading(iso: string): string {
  const date = parseDate(iso);
  return `${formatLongWeekday(date)}, ${formatLongMonthDay(date)}`;
}

export default function LiveEventDays({
  events,
  newsletterSource,
  forecastsByTown = null,
  artistGenres = {},
  empty,
  handoff = null,
}: {
  events: Hwy4Event[];
  newsletterSource: string;
  forecastsByTown?: TownForecasts | null;
  artistGenres?: Record<string, string>;
  empty: ReactNode;
  handoff?: NextWeekendHandoff | null;
}) {
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const [clock, setClock] = useState<PacificNow | null>(null);

  useEffect(() => {
    const tick = () => {
      setNowMinutes(nowPacificMinutes());
      setClock(pacificNow());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => {
    if (nowMinutes === null) return events;
    return filterListableNow(events, nowMinutes);
  }, [events, nowMinutes]);

  const activeClock = clock ?? handoff?.serverNow ?? null;
  const offer =
    handoff != null && activeClock != null
      ? shouldOfferNextWeekend({
          pageRange: handoff.pageRange,
          today: activeClock,
          minutesOfDay: activeClock.minutesOfDay,
          stillOnCount: visible.length,
        })
      : false;

  const grouped = groupByDate(visible);

  return (
    <>
      {offer && handoff && activeClock && (
        <div
          id="next-weekend"
          className="mb-8 rounded-lg border border-pine/40 bg-white px-4 py-4"
        >
          <p className="leading-relaxed text-stone">
            {nextWeekendHandoffLead({
              stillOnCount: visible.length,
              listedCount: handoff.listedCount,
              todayIso: activeClock.iso,
              pageRange: handoff.pageRange,
            })}
          </p>
          <Link
            href={handoff.href}
            className="mt-3 inline-flex items-center rounded-full bg-pine px-4 py-2 text-sm font-semibold text-white hover:bg-forest"
          >
            Next weekend
            <span className="sr-only">, {handoff.dateLabel}</span>
            <span aria-hidden="true"> →</span>
          </Link>
          <p className="mt-2 text-xs uppercase tracking-wide text-stone-light">
            {handoff.dateLabel}
          </p>
        </div>
      )}

      {grouped.length > 0 ? (
        <div className="mb-10 space-y-8">
          {(() => {
            let priorCount = 0;
            return grouped.map(([date, dayEvents]) => {
              const localIdx = 4 - priorCount;
              priorCount += dayEvents.length;
              const newsletterAfterIndex =
                localIdx >= 0 && localIdx < dayEvents.length ? localIdx : undefined;
              return (
                <section key={date}>
                  <h2 className="font-display mb-3 border-b border-stone-light/30 pb-1 text-lg font-semibold text-forest">
                    {dayHeading(date)}
                  </h2>
                  <SimpleEventList
                    events={dayEvents}
                    newsletterAfterIndex={newsletterAfterIndex}
                    newsletterSource={newsletterSource}
                    forecastsByTown={forecastsByTown}
                    artistGenres={artistGenres}
                  />
                </section>
              );
            });
          })()}
        </div>
      ) : offer ? null : (
        empty
      )}
    </>
  );
}
