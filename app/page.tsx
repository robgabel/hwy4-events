import { supabase } from "@/lib/supabase";
import { Hwy4Event, Hwy4Org } from "@/lib/types";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import { generateEventSlug } from "@/lib/slugs";
import Header from "@/components/Header";
import EventList from "@/components/EventList";

export const revalidate = 3600; // revalidate every hour

async function getEvents(): Promise<Hwy4Event[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("hwy4_events")
    .select(
      "id, name, description, date, start_time, end_time, venue_name, town, address, category, artists, status, price, event_url, source_url, source_name, visibility, org_slug, importance"
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

function ItemListSchema({ events }: { events: Hwy4Event[] }) {
  const publicEvents = events.filter((e) => e.visibility === "public");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Upcoming Events Along Highway 4",
    description:
      "Live music, festivals, and community events in the Sierra Nevada foothills of Calaveras County.",
    numberOfItems: publicEvents.length,
    itemListElement: publicEvents.slice(0, 50).map((event, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${SITE_URL}/events/${generateEventSlug(event.name, event.date, event.town)}`,
      item: {
        "@type": "Event",
        name: event.name,
        startDate: event.start_time
          ? `${event.date}T${event.start_time}`
          : event.date,
        ...(event.end_time && { endDate: `${event.date}T${event.end_time}` }),
        location: {
          "@type": "Place",
          name: event.venue_name,
          address: {
            "@type": "PostalAddress",
            addressLocality: event.town,
            addressRegion: "CA",
            addressCountry: "US",
          },
        },
        ...(event.description && { description: event.description }),
        ...(event.price && {
          offers: {
            "@type": "Offer",
            price: event.price === "Free" ? "0" : event.price,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
          },
        }),
        eventAttendanceMode:
          "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function Home() {
  const [events, orgs] = await Promise.all([getEvents(), getOrgs()]);

  return (
    <main>
      <Header />
      <ItemListSchema events={events} />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <section aria-label="What events are happening along Highway 4?">
          <div className="mb-6 text-center text-stone">
            <p>
              I created {SITE_NAME} to be my personal, one-stop local guide to
              live music, festivals, and community happenings in our neck of the
              woods. Never miss a Lube Room show again :)
            </p>
            <p className="mt-3">
              This site updates daily. I hope you find it as useful as I do.
              Please{" "}
              <a
                href="mailto:rob@gabel.ai"
                className="font-medium text-pine hover:underline"
              >
                email me
              </a>{" "}
              suggestions to improve it!
            </p>
            <p className="mt-3">— Rob</p>
          </div>
          <EventList initialEvents={events} orgs={orgs} />
        </section>
      </div>
    </main>
  );
}
