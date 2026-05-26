import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";
import { generateEventSlug } from "@/lib/slugs";
import { getPublishedTownSlugs } from "@/app/towns/town-content";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/faq`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  // Only published (non-draft) towns. Drafts are excluded so search engines
  // don't index unverified content.
  const townPages: MetadataRoute.Sitemap = getPublishedTownSlugs().map((slug) => ({
    url: `${SITE_URL}/towns/${slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }));

  let eventPages: MetadataRoute.Sitemap = [];

  try {
    const { supabase } = await import("@/lib/supabase");
    const today = new Date().toISOString().split("T")[0];
    const PAGE_SIZE = 60;
    let allEvents: { id: string; name: string; date: string; town: string }[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("hwy4_events")
        .select("id, name, date, town")
        .gte("date", today)
        .neq("status", "cancelled")
        .order("date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) break;
      allEvents = allEvents.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    eventPages = allEvents.map((event) => ({
      url: `${SITE_URL}/events/${generateEventSlug(event.name, event.date, event.town)}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // Supabase not configured — return static pages only
  }

  return [...staticPages, ...townPages, ...eventPages];
}
