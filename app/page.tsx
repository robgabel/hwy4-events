import { supabase } from "@/lib/supabase";
import { Hwy4Event, Hwy4Org } from "@/lib/types";
import { dedupeEvents } from "@/lib/dedupe-events";
import { JsonLd, buildItemList } from "@/lib/schema";
import Header from "@/components/Header";
import EventList from "@/components/EventList";
import WeeklyBriefing from "@/components/WeeklyBriefing";
import ShareSiteLink from "@/components/ShareSiteLink";
import Link from "next/link";

export const revalidate = 3600; // revalidate every hour

async function getEvents(): Promise<Hwy4Event[]> {
  const today = new Date().toISOString().split("T")[0];
  const PAGE_SIZE = 1000;
  let allEvents: Hwy4Event[] = [];
  let from = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("hwy4_events")
      .select(
        "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, event_url, source_url, source_name, source_event_id, image_url, visibility, org_slug, importance, robs_pick, is_weekly, verification_status",
        { count: "exact" }
      )
      .gte("date", today)
      .neq("status", "cancelled")
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[getEvents] Failed to fetch events:", error);
      return allEvents;
    }

    allEvents = allEvents.concat(data as Hwy4Event[]);
    console.log(`[getEvents] Batch: from=${from}, rows=${data?.length}, total so far=${allEvents.length}, db count=${count}`);

    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const deduped = dedupeEvents(allEvents);
  if (deduped.length !== allEvents.length) {
    console.log(
      `[getEvents] Collapsed ${allEvents.length - deduped.length} duplicate event(s).`
    );
  }
  console.log(`[getEvents] Done. Total events: ${deduped.length}`);
  return deduped;
}

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
  const [events, orgs, greeting, briefing, weekendBriefing] = await Promise.all([
    getEvents(),
    getOrgs(),
    getGreeting(),
    getBriefing(),
    getWeekendBriefing(),
  ]);

  return (
    <main>
      <Header greeting={greeting} />
      <JsonLd data={buildItemList(events)} />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <section aria-label="What events are happening along Highway 4?">
          <div className="mb-6 text-center text-stone">
            <p>
              Live music, festivals, and community events from Angels Camp to Bear Valley — updated daily.
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
          <EventList initialEvents={events} orgs={orgs} />
        </section>
      </div>
    </main>
  );
}
