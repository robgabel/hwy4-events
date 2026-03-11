import { supabase } from "@/lib/supabase";
import { Hwy4Event } from "@/lib/types";
import Header from "@/components/Header";
import EventList from "@/components/EventList";

export const revalidate = 3600; // revalidate every hour

async function getEvents(): Promise<Hwy4Event[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, event_url, source_url, source_name"
    )
    .gte("date", today)
    .eq("is_past", false)
    .neq("status", "cancelled")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error("Failed to fetch events:", error);
    return [];
  }

  return data as Hwy4Event[];
}

export default async function Home() {
  const events = await getEvents();

  return (
    <main>
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <EventList initialEvents={events} />
      </div>
    </main>
  );
}
