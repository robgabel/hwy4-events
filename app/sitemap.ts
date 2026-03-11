import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";
import { generateEventSlug } from "@/lib/slugs";

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

  let eventPages: MetadataRoute.Sitemap = [];

  try {
    const { supabase } = await import("@/lib/supabase");
    const today = new Date().toISOString().split("T")[0];
    const { data: events } = await supabase
      .from("hwy4_events")
      .select("id, name, date, town")
      .gte("date", today)
      .eq("is_past", false)
      .neq("status", "cancelled")
      .order("date", { ascending: true });

    eventPages = (events || []).map((event) => ({
      url: `${SITE_URL}/events/${generateEventSlug(event.name, event.date, event.town)}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // Supabase not configured — return static pages only
  }

  return [...staticPages, ...eventPages];
}
