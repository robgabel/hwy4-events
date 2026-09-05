/**
 * Who writes each `hwy4_events.org_slug`, and what "unhealthy" means for it.
 *
 * The nightly health report (scripts/lib/health.ts) used one rule for every
 * source: "no row written in >7 days ⇒ the scraper may be silently failing."
 * That rule is only true for sources the nightly Action actually runs. It is
 * false — permanently, by construction — for the rest:
 *
 *   - A SEED source (Big Trees, the Lube Room, the Camp Connell beer garden)
 *     is transcribed by hand a season at a time. `last_scraped_at` is the last
 *     time a human ran the seed, so it climbs past 7 days the week after every
 *     seeding and never comes back down. Its watcher is the weekly fingerprint
 *     cron, not this report.
 *   - An EXTERNAL-CRON source (Blue Lake Springs) is written by a Vercel route
 *     that stamps `last_scraped_at` only on INSERT. A Monday run that correctly
 *     finds no new flyer writes nothing, so the clock keeps running while the
 *     scraper is perfectly healthy. This Action cannot see whether that route
 *     ran at all, so it must not claim to.
 *   - A RETIRED source has no writer at all. Nothing will ever refresh it.
 *
 * On 2026-09-05 that single rule produced 11 warnings, and every one of them
 * was a false positive: four retired Facebook groups (since fixed), two
 * seed-owned venues, one Vercel-cron venue, one annual parade, and one
 * nightly source whose page genuinely had nothing on it. A report that cries
 * wolf every morning is a report nobody reads — which is how the far worse
 * bug underneath it (health.ts saw only 13 of 23 sources; see listOrgSlugs)
 * went unnoticed for months.
 *
 * So the rule is now per-owner, and the mapping below is the decision record:
 * an entry here is a claim that nothing in the nightly Action refreshes this
 * slug and a staleness warning would therefore be noise. Anything ABSENT
 * defaults to `nightly` — the loud option — so a new source, or a scraper
 * quietly dropped from the dispatch table, still warns.
 */

export type SourceOwner = "nightly" | "external-cron" | "seed" | "retired";

export interface SourceOwnership {
  owner: SourceOwner;
  /** Who or what refreshes it, named so the reader can go look. */
  writer: string;
}

/**
 * org_slug → owner, for every slug NOT refreshed by scripts/scrape.ts.
 * Absent ⇒ `nightly` (see the module comment: unknown fails loud).
 */
export const SOURCE_OWNERSHIP: Record<string, SourceOwnership> = {
  // --- Retired: rows exist, no writer was ever committed -------------------
  // A June 2026 one-off wrote a handful of rows from corridor Facebook groups.
  // Those groups are now read by hwy4-fb-groups, which lands pending
  // event_submissions instead of events, so it owns no org_slug and these
  // three can never be written again.
  "fb-group-uh4ccc": { owner: "retired", writer: "none (one-off June 2026 run)" },
  "fb-group-388511408445423": { owner: "retired", writer: "none (one-off June 2026 run)" },
  "fb-group-upperhwy4": { owner: "retired", writer: "none (one-off June 2026 run)" },
  // Same shape: 14 rows written 2026-05-28, no scraper or seed in the repo.
  // The venue still shows up in lib/venue-gaps.ts as a registry gap; that is a
  // different worklist from "a scraper is broken".
  "murphys-library": { owner: "retired", writer: "none (one-off May 2026 run)" },

  // --- Seed-owned: a human transcribes the schedule ------------------------
  // These venues publish only images or prose recurrence rules, so they are
  // blocklisted from every auto-scraper (scripts/lib/manual-sources.ts) and a
  // fingerprint cron pings Slack when the source page changes.
  "calaveras-big-trees-state-park": {
    owner: "seed",
    writer: "scripts/seed-bigtrees-programs-2026.ts (watched by /api/check-bigtrees-schedule)",
  },
  "camp-connell-general-store": {
    owner: "seed",
    writer: "scripts/seed-camp-connell-beer-garden-2026.ts (watched by /api/check-camp-connell-schedule)",
  },
  "lube-room": {
    owner: "seed",
    writer: "scripts/seed-lube-room-summer-2026.ts (watched by /api/check-lube-schedule)",
  },
  "lake-alpine-lodge": { owner: "seed", writer: "scripts/seed-lake-alpine-lodge-2026.ts" },
  // Deliberately NOT blocklisted (see CLAUDE.md) — but nothing scrapes it
  // today either, so the seed is its only writer.
  "hinterhaus-distilling": { owner: "seed", writer: "scripts/seed-hinterhaus-tours-2026.ts" },
  // One event a year. Re-seeded each spring.
  "arnold-parade": { owner: "seed", writer: "scripts/seed-arnold-parade-2026.ts" },

  // --- External cron: written by a Vercel route, not this Action -----------
  // Stamps last_scraped_at only on INSERT, so days-since-write measures how
  // long since the HOA posted a new flyer, not whether the route is alive.
  "blue-lake-springs": { owner: "external-cron", writer: "/api/scrape-bls (Mondays 13:00 UTC)" },
};

/**
 * Dispatch key in scripts/scrape.ts → the `org_slug` that scraper writes.
 *
 * Mostly identity, which is exactly why the two that differ were a live bug:
 * health.ts asked `scrapedSources.includes(org_slug)`, so `fb-discover-arnold`
 * never matched its `hwy4-fb-discover` dispatch key and read as "not run"
 * every night. `null` means the scraper writes no hwy4_events rows at all.
 *
 * Pinned to the real dispatch table by scripts/test/source-ownership.test.ts.
 */
export const DISPATCH_ORG_SLUG: Record<string, string | null> = {
  "arnold-rim-trail": "arnold-rim-trail",
  "bistro-espresso": "bistro-espresso",
  "gocalaveras": "gocalaveras",
  "mystic-saloon": "mystic-saloon",
  "hwy4-fb-discover": "fb-discover-arnold",
  // Lands pending event_submissions rows, never events.
  "hwy4-fb-groups": null,
  "visit-murphys": "visit-murphys",
  "red-cross": "red-cross",
  "sequoia-woods": "sequoia-woods",
  "brice-station": "brice-station",
  "murphys-irish-pub": "murphys-irish-pub",
  // The three config-driven Firecrawl sources (scrapers/firecrawl-sources.ts)
  // use their slug as the org_slug; the test pins this list against that file.
  "bear-valley": "bear-valley",
  "bvac": "bvac",
  "moose-lodge": "moose-lodge",
};

/** The org_slugs the nightly Action can write, whether or not it has yet. */
export function nightlyOrgSlugs(dispatchKeys: string[]): string[] {
  const slugs = new Set<string>();
  for (const key of dispatchKeys) {
    // An unmapped key is assumed to write its own name — the same fail-loud
    // default as SOURCE_OWNERSHIP, so a new scraper shows up in the report
    // before anyone remembers to touch this file.
    const slug = key in DISPATCH_ORG_SLUG ? DISPATCH_ORG_SLUG[key] : key;
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

export function ownershipFor(orgSlug: string): SourceOwnership {
  return (
    SOURCE_OWNERSHIP[orgSlug] ?? {
      owner: "nightly",
      writer: "scripts/scrape.ts",
    }
  );
}

export interface SourceFacts {
  orgSlug: string;
  /** Events dated today or later. */
  futureEventCount: number;
  /** Days since the newest last_scraped_at; null when the source has none. */
  daysSinceScrape: number | null;
  /** Did the nightly Action dispatch a scraper for this slug in THIS pass? */
  ranThisRun: boolean;
}

export interface SourceVerdict {
  owner: SourceOwner;
  /** Short label for the report's Status column. */
  status: string;
  /** Actionable warnings. Empty means "nothing for a human to do here". */
  warnings: string[];
}

/**
 * The one place the report decides whether a source is a problem.
 *
 * Deliberately does NOT warn on staleness for a source that ran this pass.
 * "Days since we last wrote a row" is a property of how often the venue posts,
 * not of our health: Bear Valley Mountain Resort's page held nothing but two
 * lodging promos for eleven days, and the scraper reading it correctly and
 * extracting nothing is not a failure. What IS ours to catch — the source
 * draining to zero, or a scraper vanishing from the dispatch table — is below.
 * A source that runs clean but keeps adding nothing is the weekly memo's
 * `watching` bucket (/api/agent/scraper-health-memo), which reasons over 14
 * days of scrape_runs instead of one night.
 */
export function classifySource(facts: SourceFacts): SourceVerdict {
  const { owner, writer } = ownershipFor(facts.orgSlug);
  const age =
    facts.daysSinceScrape === null ? "never written" : `${facts.daysSinceScrape}d`;
  const warnings: string[] = [];

  if (owner === "retired") {
    return { owner, status: `RETIRED (${age})`, warnings };
  }

  if (owner === "seed" || owner === "external-cron") {
    const label = owner === "seed" ? "SEED" : "CRON";
    // Staleness is meaningless for both (see the module comment). Running dry
    // is not: a seeded season that has fully elapsed needs re-seeding, and a
    // cron venue with nothing upcoming is worth one look at the route's logs.
    if (facts.futureEventCount === 0) {
      warnings.push(
        `${facts.orgSlug}: no future events, and the nightly scrape does not ` +
          `write this source — refresh it via ${writer}.`
      );
      return { owner, status: `${label}: 0 future events`, warnings };
    }
    return { owner, status: `${label} (${age})`, warnings };
  }

  // --- nightly -------------------------------------------------------------
  if (!facts.ranThisRun) {
    warnings.push(
      `${facts.orgSlug}: has events but no scraper ran for it in this pass. ` +
        `Either it was dropped from the dispatch table in scripts/scrape.ts, ` +
        `or it needs an entry in scripts/lib/source-ownership.ts saying what ` +
        `writes it now.`
    );
    return { owner, status: `NO SCRAPER (${age})`, warnings };
  }

  if (facts.futureEventCount === 0) {
    warnings.push(
      `${facts.orgSlug}: scraper ran but the source has no future events. ` +
        `Check whether the page changed or the venue stopped posting.`
    );
    return { owner, status: "WARN: 0 future events", warnings };
  }

  if (facts.daysSinceScrape === null) {
    warnings.push(
      `${facts.orgSlug}: has future events but no last_scraped_at timestamp.`
    );
    return { owner, status: "WARN: no timestamp", warnings };
  }

  return { owner, status: `OK (${age})`, warnings };
}
