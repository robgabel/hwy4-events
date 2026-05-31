import { supabase } from "@/lib/supabase";
import { Hwy4Org } from "@/lib/types";
import { getUpcomingEvents } from "@/lib/events-data";
import { JsonLd, buildItemList } from "@/lib/schema";
import Header from "@/components/Header";
import EventList from "@/components/EventList";
import WeeklyBriefing from "@/components/WeeklyBriefing";
import ShareSiteLink from "@/components/ShareSiteLink";
import Link from "next/link";

export const revalidate = 3600; // revalidate every hour

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
  const [events, orgs, greeting, briefing, weekendBriefing] = await Promise.all([
    getUpcomingEvents(),
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
          <EventList initialEvents={events} orgs={orgs} />
        </section>
      </div>
    </main>
  );
}
