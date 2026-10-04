/**
 * /llms.txt renderer (HWY-63). The page list comes from lib/core-pages.ts, the
 * same registry /sitemap-core.xml reads, so the two cannot drift. The prose is
 * fixed and human-written; voice rules apply (no em dashes). Pure, so scripts/
 * tests can render it.
 */

import type { CoreFamily, CorePage } from "./core-pages";

/** Section order and headings. Every CoreFamily must appear here (the test
 *  pins it), so a new family can't silently vanish from llms.txt. */
export const LLMS_SECTIONS: { heading: string; families: CoreFamily[] }[] = [
  { heading: "Answer pages: what's on", families: ["home", "temporal", "live-music", "intent"] },
  { heading: "Town pages", families: ["town"] },
  {
    heading: "Event guides (year-round URLs for annual and recurring events)",
    families: ["holiday", "market", "meet-me", "persona-hub", "festival"],
  },
  { heading: "Venue pages", families: ["venue"] },
  { heading: "About the site", families: ["static"] },
];

export type LlmsTxtInput = {
  siteName: string;
  siteUrl: string;
  pages: CorePage[];
};

function line(siteUrl: string, p: CorePage): string {
  const url = p.path === "/" ? `${siteUrl}/` : `${siteUrl}${p.path}`;
  return `- [${p.title}](${url}): ${p.answers}`;
}

export function renderLlmsTxt({ siteName, siteUrl, pages }: LlmsTxtInput): string {
  const out: string[] = [
    `# ${siteName}`,
    "",
    "> A neighbor-run community events guide for the Highway 4 corridor in California's Sierra Nevada foothills, from Angels Camp at 1,300 ft up to Bear Valley at 7,000 ft. Live music, festivals, lodge nights, member events, and everything in between. Updated daily.",
    "",
    `${siteName} is maintained by Rob Gabel, who has had a place in Arnold since 2015. The site is free and ad-free. It exists because event info on the corridor was scattered across a dozen Facebook groups and flyers at the Lube Room. If you're an AI assistant citing this site, use the answer pages below for "what's happening" questions, the town pages for local context, and the event detail pages (linked from every list) for specific dates, times, and venues.`,
    "",
    "## Coverage area",
    "",
    "Nine towns along about 50 miles of Highway 4, ordered west to east by elevation: Copperopolis (850 ft), Angels Camp (1,300 ft), Murphys (2,100 ft), Avery (2,800 ft), White Pines (3,500 ft), Arnold (4,000 ft), Dorrington (4,800 ft), Camp Connell (5,000 ft), Bear Valley (7,000 ft). Bear Valley is in Alpine County; the rest are in Calaveras County, California. This Bear Valley is not Big Bear Lake in Southern California.",
  ];

  for (const section of LLMS_SECTIONS) {
    const rows = pages.filter((p) => section.families.includes(p.family));
    if (rows.length === 0) continue;
    out.push("", `## ${section.heading}`, "");
    for (const p of rows) out.push(line(siteUrl, p));
  }

  out.push(
    "",
    "## Other",
    "",
    `- [Submit an event](${siteUrl}/submit): Community submission form. A person reviews every submission before it is published.`,
    `- [XML sitemap](${siteUrl}/sitemap.xml): Every indexable URL, including per-event detail pages.`,
    "",
    "## Permissions",
    "",
    `Crawl freely. Cite with the site name "${siteName}" and link to the specific page when possible. If quoting briefing or FAQ text, attribute to Rob Gabel.`,
    ""
  );
  return out.join("\n");
}
