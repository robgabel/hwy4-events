// Calaveras region — server/scripts-only config (emails, SEO plumbing,
// schema.org strings, newsletter chrome). NEVER imported by client
// components; see regions/types.ts RegionOps.
//
// INSTANCE FILE — values moved VERBATIM from the engine files noted per block.

import type { RegionOps } from "../types";

export const CALAVERAS_OPS: RegionOps = {
  // Moved from app/api/newsletter/{send,subscribe,confirm}, app/api/feedback,
  // lib/geocode.ts, lib/static-map.ts.
  emails: {
    newsletterFrom: "newsletter@hwy4events.com",
    replyTo: "robgabel@gmail.com",
    owner: "robgabel@gmail.com",
    hello: "hello@hwy4events.com",
  },
  // Moved from app/api/verify-events/route.ts + lib/agent/qa-audit.ts.
  // (The crawler botName lives in RegionCore — lib/constants.ts composes the
  // weather UA from it, and constants is client-reachable.)
  userAgents: {
    verifierName: "Hwy4Events-Verifier",
    qaName: "Hwy4EventsQA",
  },
  // Moved from lib/agent/gsc.ts.
  seo: {
    gscPropertyDefault: "sc-domain:hwy4events.com",
  },
  // Moved from lib/schema.tsx.
  schemaOrg: {
    orgDescription:
      "Daily event briefing and listings for the Highway 4 corridor, from Angels Camp to Bear Valley in the California Sierra Nevada.",
    areaServed: "Highway 4 Corridor, Calaveras County, California",
    founderName: "Rob Gabel",
    founderPath: "/about/rob-gabel",
    logoPath: "/millie-happy.svg",
    itemListName: "Upcoming Events Along Highway 4",
    itemListDescription:
      "Today's events and this week's lineup along the Highway 4 corridor in the Sierra Nevada foothills.",
  },
  // Moved from lib/newsletter.ts (email shell chrome — the LLM system prompt
  // and persona copy stay in place until the prompt-layer PR).
  newsletter: {
    subjectPrefix: "What's happening on the 4",
    heroSubline: "Weekly roundup · Angels Camp to Bear Valley",
    forwardBodyLede:
      "Found this — it's the Hwy 4 events roundup (Angels Camp to Bear Valley). Worth a look:",
    smsBodyLede: "Found this — it's the Hwy 4 events roundup.",
    footerSpan: "Angels Camp to Bear Valley, CA",
    assets: {
      tree: "/email/tree.png",
      mascot: "/email/millie-happy.png",
      mascotAlt: "Millie the sheepadoodle",
    },
  },
  // Moved from lib/agent/qa-audit.ts dynamicTargets.
  qaAudit: {
    townSlugSample: ["arnold", "murphys", "angels-camp"],
  },
};
