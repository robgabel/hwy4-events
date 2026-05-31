import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";
import { generateEventSlug } from "@/lib/slugs";
import { getPublishedTownSlugs } from "@/app/towns/town-content";
import { TEMPORAL_CONFIG } from "@/lib/date-windows";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    // Evergreen temporal aggregators. Daily changefreq + high priority:
    // permanent URLs whose content refreshes constantly, prime AEO targets.
    ...Object.values(TEMPORAL_CONFIG).map((cfg) => ({
      url: `${SITE_URL}${cfg.path}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.9,
    })),
    {
      url: `${SITE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/about/rob-gabel`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.5,
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
    // Reads the site-wide cached upcoming-events set — no dedicated DB scan.
    const { getUpcomingEventSlugRows } = await import("@/lib/events-data");
    const allEvents = await getUpcomingEventSlugRows();

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
