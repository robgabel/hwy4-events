/**
 * The core page registry (HWY-63): every evergreen "answer page" we advertise,
 * defined once and read by both /sitemap-core.xml and /llms.txt so the two can
 * never list different pages again (llms.txt was a static file that stopped at
 * four pages while the sitemap grew to ~40).
 *
 * Pure: the caller supplies the dynamic families (published towns, sitemap-gated
 * venue hubs) so this module needs no database and scripts/ tests import it.
 * Relative imports only, for the same reason.
 */

import { TEMPORAL_CONFIG } from "./date-windows";
import { INTENT_CONFIG } from "./intent-pages";
import { HOLIDAY_GUIDES } from "./holiday-pages";
import { MARKET_GUIDES } from "./market-pages";
import { MEET_ME_GUIDES } from "./meet-me-pages";
import { PERSONA_HUBS } from "./persona-hubs";
import { LIVE_MUSIC_LENSES, LIVE_MUSIC_PAGE } from "./live-music";

export type CoreFamily =
  | "home"
  | "temporal"
  | "town"
  | "intent"
  | "live-music"
  | "holiday"
  | "market"
  | "meet-me"
  | "persona-hub"
  | "festival"
  | "venue"
  | "static";

export type ChangeFreq = "daily" | "weekly" | "monthly" | "yearly";

export type CorePage = {
  /** Site-relative path ("/" for the homepage). */
  path: string;
  family: CoreFamily;
  /** Link text in llms.txt. */
  title: string;
  /** One line: the question this page answers. Voice rules apply (no em dashes). */
  answers: string;
  changefreq: ChangeFreq;
  priority: number;
  /** Re-renders from live event data, so the sitemap stamps today's lastmod. */
  live: boolean;
};

export type CorePageInput = {
  /** Published (non-draft) town pages. */
  towns: { slug: string; name: string }[];
  /** Venue hubs that clear the sitemap gate (lib/venue-pages.ts). */
  venues: { slug: string; name: string }[];
};

/** Every core page, in sitemap order. */
export function corePages({ towns, venues }: CorePageInput): CorePage[] {
  return [
    {
      path: "/",
      family: "home",
      title: "All upcoming events",
      answers:
        "What's happening on Highway 4 today and this week? The full live calendar, Angels Camp to Bear Valley.",
      changefreq: "daily",
      priority: 1,
      live: true,
    },
    ...Object.values(TEMPORAL_CONFIG).map(
      (c): CorePage => ({
        path: c.path,
        family: "temporal",
        title: c.label,
        answers: c.metaDescription,
        changefreq: "daily",
        priority: 0.9,
        live: true,
      })
    ),
    ...towns.map(
      (t): CorePage => ({
        path: `/towns/${t.slug}`,
        family: "town",
        title: t.name,
        answers: `What's happening in ${t.name} this weekend, and what is the town like? Upcoming events, venues, and local facts.`,
        changefreq: "weekly",
        priority: 0.9,
        live: true,
      })
    ),
    // Intent landing pages (visitor search: "things to do near …").
    ...Object.values(INTENT_CONFIG).map(
      (c): CorePage => ({
        path: c.path,
        family: "intent",
        title: c.label,
        answers: c.metaDescription,
        changefreq: "daily",
        priority: 0.8,
        live: true,
      })
    ),
    // Live-music hub (HWY-37): Tonight / This weekend / Upcoming lenses.
    {
      path: LIVE_MUSIC_PAGE.path,
      family: "live-music",
      title: LIVE_MUSIC_PAGE.label,
      answers: LIVE_MUSIC_LENSES.upcoming.metaDescription,
      changefreq: "daily",
      priority: 0.8,
      live: true,
    },
    // Evergreen holiday guides (HWY-6).
    ...HOLIDAY_GUIDES.map(
      (g): CorePage => ({
        path: g.path,
        family: "holiday",
        title: g.label,
        answers: g.metaDescription,
        changefreq: "weekly",
        priority: 0.8,
        live: true,
      })
    ),
    // Evergreen farmers-market guides (HWY-31).
    ...MARKET_GUIDES.map(
      (g): CorePage => ({
        path: g.path,
        family: "market",
        title: g.label,
        answers: g.metaDescription,
        changefreq: "weekly",
        priority: 0.8,
        live: true,
      })
    ),
    // Meet Me in Murphys (HWY-38).
    ...MEET_ME_GUIDES.map(
      (g): CorePage => ({
        path: g.path,
        family: "meet-me",
        title: g.label,
        answers: g.metaDescription,
        changefreq: "weekly",
        priority: 0.8,
        live: true,
      })
    ),
    // Persona SEO hubs (HWY-39).
    ...PERSONA_HUBS.map(
      (g): CorePage => ({
        path: g.path,
        family: "persona-hub",
        title: g.label,
        answers: g.metaDescription,
        changefreq: "weekly",
        priority: 0.8,
        live: true,
      })
    ),
    // Seasonal festival landing page (HWY-3).
    {
      path: "/bear-valley-music-festival-2026",
      family: "festival",
      title: "Bear Valley Music Festival 2026",
      answers:
        "When is the Bear Valley Music Festival 2026, where is it held, and what is on the schedule?",
      changefreq: "daily",
      priority: 0.8,
      live: true,
    },
    // Venue hub pages (HWY-9), sitemap-gated by the caller.
    ...venues.map(
      (v): CorePage => ({
        path: `/venues/${v.slug}`,
        family: "venue",
        title: v.name,
        answers: `What's coming up at ${v.name}? Upcoming events plus practical venue facts.`,
        changefreq: "daily",
        priority: 0.7,
        live: true,
      })
    ),
    {
      path: "/hosts",
      family: "static",
      title: "For vacation rental hosts",
      answers:
        "How can an Airbnb or vacation rental host show guests what's happening on Highway 4 during their stay?",
      changefreq: "monthly",
      priority: 0.5,
      live: false,
    },
    {
      path: "/about",
      family: "static",
      title: "About Hwy 4 Events",
      answers: "Who runs this site, what it covers, which towns and venues, and how to send feedback.",
      changefreq: "monthly",
      priority: 0.7,
      live: false,
    },
    {
      path: "/about/rob-gabel",
      family: "static",
      title: "Rob Gabel",
      answers: "Who is the neighbor behind Hwy 4 Events?",
      changefreq: "yearly",
      priority: 0.5,
      live: false,
    },
    {
      path: "/faq",
      family: "static",
      title: "Frequently asked questions",
      answers:
        "Where to find live music, festivals in Calaveras County, Bear Valley summer events, members-only venues, and how to submit an event.",
      changefreq: "monthly",
      priority: 0.6,
      live: false,
    },
  ];
}
