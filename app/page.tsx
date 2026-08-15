import { supabase } from "@/lib/supabase";
import { Hwy4Org } from "@/lib/types";
import { getHomepageEvents, toListEvents } from "@/lib/events-data";
import { repairEventLinks, logLinkRepairs } from "@/lib/briefing-links";
import { JsonLd, buildItemList } from "@/lib/schema";
import Header from "@/components/Header";
import EventList from "@/components/EventList";
import { getForecastsByTown } from "@/lib/weather";
import WeeklyBriefing from "@/components/WeeklyBriefing";
import RobsPicks from "@/components/RobsPicks";
import { pacificToday } from "@/lib/date-windows";
import { nowPacificMinutes } from "@/lib/event-time";
import ShareSiteLink from "@/components/ShareSiteLink";
import Link from "next/link";

// 30 min, matching the shared events-feed cache: the Rob's Picks module is
// time-aware (an ended pick drops), so the rendered page shouldn't outlive the
// clock it was rendered with by more than one feed window.
export const revalidate = 1800;

// Event fetching now lives in lib/events-data.ts (getUpcomingEvents), a shared
// cache so this page, the temporal views, town pages, and the sitemap all read
// from ONE database scan per cache window instead of each running its own.

async function getGreeting(): Promise<string | null> {
  const { data, error } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "greeting")
    .single();

  if (error || !data?.value) return null;
  return data.value;
}

async function getBriefing(): Promise<{
  text: string | null;
  date: string | null;
}> {
  const { data: textData } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "weekly_briefing")
    .single();

  const { data: dateData } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "weekly_briefing_date")
    .single();

  return {
    text: textData?.value || null,
    date: dateData?.value || null,
  };
}

async function getWeekendBriefing(): Promise<{
  text: string | null;
  date: string | null;
  label: string | null;
}> {
  const { data: textData } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "weekend_briefing")
    .single();

  const { data: dateData } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "weekend_briefing_date")
    .single();

  const { data: labelData } = await supabase
    .from("site_config")
    .select("value")
    .eq("key", "weekend_briefing_label")
    .single();

  return {
    text: textData?.value || null,
    date: dateData?.value || null,
    label: labelData?.value || null,
  };
}

async function getOrgs(): Promise<Hwy4Org[]> {
  const { data, error } = await supabase
    .from("hwy4_orgs")
    .select("id, slug, display_name")
    .order("display_name");

  if (error) {
    console.error("Failed to fetch orgs:", error);
    return [];
  }

  return data as Hwy4Org[];
}

export default async function Home() {
  const [events, orgs, greeting, briefing, weekendBriefing, forecastsByTown] =
    await Promise.all([
      getHomepageEvents(),
      getOrgs(),
      getGreeting(),
      getBriefing(),
      getWeekendBriefing(),
      getForecastsByTown(),
    ]);

  // Self-heal briefing links at render: a link that was valid at generation
  // time dies when its event is renamed or merged away later that day (the
  // 2026-08-11 shrimp-feed rename). Re-validate stored text against the live
  // feed; only slugs dated inside the feed's own window are judged, so links
  // to days that have scrolled out of the feed are never touched.
  if (events.length > 0) {
    const dates = events.map((e) => e.date).sort();
    const activeRange = { start: dates[0], end: dates[dates.length - 1] };
    for (const b of [briefing, weekendBriefing]) {
      if (!b.text) continue;
      const repair = repairEventLinks(b.text, events, { activeRange });
      logLinkRepairs("homepage-render", repair);
      b.text = repair.text;
    }
  }

  return (
    <main>
      <Header greeting={greeting} />
      <JsonLd data={buildItemList(events)} />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <section aria-label="What events are happening along Highway 4?">
          <div className="mb-6 text-center text-stone">
            <p>
              Live music, festivals, and community events updated daily.
            </p>
            <p className="mt-2 text-sm">
              <Link href="/about" className="font-medium text-pine hover:underline">About us</Link>
              {" · "}
              <Link href="/submit" className="font-medium text-pine hover:underline">Submit an event</Link>
              {" · "}
              <ShareSiteLink />
            </p>
          </div>
          {briefing.text && (
            <WeeklyBriefing
              briefing={briefing.text}
              generatedAt={briefing.date}
              weekendBriefing={weekendBriefing.text}
              weekendGeneratedAt={weekendBriefing.date}
              weekendLabel={weekendBriefing.label}
            />
          )}
          {/* Curation layer: the one-thing spotlight + up to 4 picks. Server-
           * rendered from the same fetched rows plus the festival-guide
           * registry; renders nothing when no upcoming pick or live guide
           * exists. The Pacific clock is passed in so ended picks drop
           * (accurate to this page's revalidate window). */}
          <RobsPicks
            events={events}
            todayIso={pacificToday().iso}
            nowMinutes={nowPacificMinutes()}
          />
          {/* Project to the lightweight list shape (trimmed description, no
           * scrape-only columns): the page ships the whole upcoming set into the
           * client for filtering, so only what a card renders should cross the
           * wire. JSON-LD above still uses the full rows. */}
          <EventList
            initialEvents={toListEvents(events)}
            orgs={orgs}
            forecastsByTown={forecastsByTown}
          />
        </section>
      </div>
    </main>
  );
}
