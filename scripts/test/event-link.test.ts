// Regression lock for the ONE "where does this event link to" rule
// (lib/event-link.ts). Primary source (organizer/venue/durable host) always
// wins. A GoCalaveras permalink renders as a NON-DURABLE source link (verified
// live in-browser 2026-06-03) — never for community submissions, and never in
// JSON-LD (callers gate offer URLs on `durable`).
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEventLink,
  resolveEventLinkFromOrgs,
  matchOrgForEvent,
  promotableVenueUrl,
  isMultiTenantVenue,
  type LinkEvent,
  type LinkOrg,
} from "../../lib/event-link.js";

function ev(p: Partial<LinkEvent> & { name: string }): LinkEvent {
  return {
    description: null,
    venue_name: "Unknown Venue",
    org_slug: null,
    event_url: null,
    ...p,
  };
}

const ART: LinkOrg = {
  slug: "arnold-rim-trail",
  display_name: "Arnold Rim Trail",
  canonical_url: "https://arnoldrimtrail.org/events/",
  // Enumerated spelling variants — the source really lists "Aronld Rim Trail".
  match_patterns: ["arnold rim trail", "aronld rim", "arnold rim"],
};
const BIGTREES: LinkOrg = {
  slug: "calaveras-big-trees-state-park",
  display_name: "Calaveras Big Trees State Park",
  canonical_url: "https://www.bigtrees.org/events/",
  match_patterns: ["big trees", "calaveras big trees"],
};
const GOCAL: LinkOrg = {
  slug: "gocalaveras",
  display_name: "GoCalaveras.com",
  canonical_url: null,
  match_patterns: null,
};
const ORGS = [ART, BIGTREES, GOCAL];

test("organizer canonical wins over a GoCalaveras event_url (primary source wins)", () => {
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "Creek Critters @ Big Trees State Park",
      venue_name: "Calaveras Big Trees State Park",
      org_slug: "gocalaveras",
      event_url: "https://www.gocalaveras.com/events/creek-critters-big-trees-state-park/",
    }),
    ORGS
  );
  assert.equal(r.kind, "organizer");
  assert.equal(r.href, "https://www.bigtrees.org/events/");
  assert.equal(r.durable, true);
});

test("a misconfigured org canonical that is itself a GoCalaveras permalink is NOT durable", () => {
  // Real case: the hwy4_orgs row "the-stitch-lounge" had its canonical_url set
  // to a gocalaveras.com event permalink. That must not launder a churnable
  // aggregator link into a durable organizer link (and thus into JSON-LD). It
  // falls through to the non-durable aggregator fallback instead.
  const STITCH: LinkOrg = {
    slug: "the-stitch-lounge",
    display_name: "The Stitch Lounge",
    canonical_url: "https://www.gocalaveras.com/events/the-stitch-lounge-summer-camp/",
    match_patterns: ["The Stitch Lounge"],
  };
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "The Stitch Lounge Summer Camp",
      venue_name: "The Stitch Lounge",
      org_slug: "gocalaveras",
      event_url: "https://www.gocalaveras.com/events/the-stitch-lounge-summer-camp/",
    }),
    [...ORGS, STITCH]
  );
  assert.equal(r.kind, "source");
  assert.equal(r.durable, false); // non-durable → card shows nothing, kept out of JSON-LD
});

test("Arnold Rim Trail resolves via pattern even when misspelled 'Aronld'", () => {
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "Aronld Rim Trail : Tree Identifier Walks with Mary Anne Carlton",
      venue_name: "Sierra Nevada Logging Museum",
      org_slug: "gocalaveras",
      event_url: "https://www.gocalaveras.com/events/aronld-rim-trail-...-3/",
    }),
    ORGS
  );
  assert.equal(r.kind, "organizer");
  assert.equal(r.href, "https://arnoldrimtrail.org/events/");
});

test("direct org_slug match resolves to that org's canonical", () => {
  const org = matchOrgForEvent(ev({ name: "Whatever", org_slug: "arnold-rim-trail" }), ORGS);
  assert.equal(org?.slug, "arnold-rim-trail");
});

test("GoCalaveras-only event with no matching org → non-durable source link", () => {
  const url = "https://www.gocalaveras.com/events/some-random-vendor-fair-7/";
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "Some Random Vendor Fair",
      venue_name: "Murphys Community Park",
      org_slug: "gocalaveras",
      event_url: url,
    }),
    ORGS
  );
  assert.equal(r.kind, "source");
  assert.equal(r.href, url);
  assert.equal(r.durable, false);
});

test("community submission with a GoCalaveras url stays buttonless (no aggregator fallback)", () => {
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "Neighbor Potluck",
      venue_name: "Someone's Backyard",
      org_slug: "gocalaveras",
      event_url: "https://www.gocalaveras.com/events/neighbor-potluck/",
      community_sourced: true,
    }),
    ORGS
  );
  assert.equal(r.kind, "none");
  assert.equal(r.href, null);
});

test("community exclusion is narrow: a durable (facebook) url still links out", () => {
  const r = resolveEventLink(
    ev({
      name: "Show",
      event_url: "https://www.facebook.com/events/123",
      community_sourced: true,
    })
  );
  assert.equal(r.kind, "source");
  assert.equal(r.durable, true);
});

test("stable-host event_url (Visit Murphys) renders as a durable source link", () => {
  const r = resolveEventLink(
    ev({ name: "Wine Walk", event_url: "https://visitmurphys.com/events/wine-walk" })
  );
  assert.equal(r.kind, "source");
  assert.equal(r.href, "https://visitmurphys.com/events/wine-walk");
  assert.equal(r.durable, true);
});

test("facebook event links are treated as a durable source (not aggregator-suppressed)", () => {
  const r = resolveEventLink(ev({ name: "Show", event_url: "https://www.facebook.com/events/123" }));
  assert.equal(r.kind, "source");
  assert.equal(r.durable, true);
});

test("priority: organizer beats venue beats source", () => {
  const e = ev({
    name: "Big Trees Hike",
    org_slug: "calaveras-big-trees-state-park",
    event_url: "https://visitmurphys.com/x",
  });
  const r = resolveEventLink(e, {
    org: BIGTREES,
    venueUrl: "https://venue.example/x",
  });
  assert.equal(r.kind, "organizer");

  const r2 = resolveEventLink(ev({ name: "x", event_url: "https://visitmurphys.com/x" }), {
    venueUrl: "https://venue.example/x",
    venueName: "The Venue",
  });
  assert.equal(r2.kind, "venue");
  assert.equal(r2.href, "https://venue.example/x");
});

test("www. and bare gocalaveras.com both render as a non-durable source", () => {
  for (const url of [
    "https://gocalaveras.com/events/x/",
    "https://www.gocalaveras.com/events/x/",
  ]) {
    const r = resolveEventLink(ev({ name: "x", event_url: url }));
    assert.equal(r.kind, "source");
    assert.equal(r.durable, false);
    assert.equal(r.href, url);
  }
});

test("unparseable event_url → none (junk never renders as a link)", () => {
  assert.equal(resolveEventLink(ev({ name: "x", event_url: "not a url" })).kind, "none");
});

// --- URL scheme allowlist (2026-07-02 review, P1): a javascript:/data: URL in
//     ANY slot is treated as absent, never rendered as an href. ---

test("javascript: event_url never becomes a link", () => {
  const r = resolveEventLink(
    ev({ name: "x", event_url: "javascript://evil.com/%0aalert(1)" })
  );
  assert.equal(r.kind, "none");
  assert.equal(r.href, null);
});

test("javascript: organizer canonical_url is not durable — falls through", () => {
  const EVIL_ORG: LinkOrg = {
    slug: "evil",
    display_name: "Evil",
    canonical_url: "javascript://evil.com/%0aalert(1)",
    match_patterns: ["evil show"],
  };
  const r = resolveEventLinkFromOrgs(
    ev({ name: "Evil Show", org_slug: "evil" }),
    [EVIL_ORG]
  );
  assert.equal(r.kind, "none");
  assert.equal(r.href, null);
});

test("promotableVenueUrl rejects a javascript: / data: website", () => {
  assert.equal(promotableVenueUrl("My Bar", "javascript://evil.com/%0aalert(1)"), null);
  assert.equal(promotableVenueUrl("My Bar", "data:text/html,<script>alert(1)</script>"), null);
});

// --- Venue-canonical promotion guard (the resolver's priority-#2 path) ---

test("promotableVenueUrl promotes a single-operator venue website", () => {
  assert.equal(
    promotableVenueUrl("Stevenot Winery", "https://www.stevenotwinery.com/"),
    "https://www.stevenotwinery.com/"
  );
});

test("promotableVenueUrl rejects multi-tenant venues (park / community center / town square)", () => {
  assert.equal(promotableVenueUrl("Murphys Community Park", "https://murphyspark.com/"), null);
  assert.equal(
    promotableVenueUrl("Perry Walther Community Center", "https://bearvalleyparentsgroup.com/"),
    null
  );
  assert.equal(promotableVenueUrl("Copperopolis Town Square", "https://example.com/"), null);
});

test("promotableVenueUrl rejects social pages and missing/junk urls", () => {
  assert.equal(
    promotableVenueUrl("Utica Park", "https://www.facebook.com/pages/Utica-Park/152740228072736/"),
    null
  );
  assert.equal(promotableVenueUrl("My Bar", null), null);
  assert.equal(promotableVenueUrl("My Bar", "not a url"), null);
});

test("promotableVenueUrl rejects an aggregator (GoCalaveras) venue website — Places sometimes syncs one in", () => {
  // hwy4_venues.website is auto-synced from Google Places, which occasionally
  // returns a GoCalaveras listing as a venue's "website". That host is the
  // non-durable fallback, never a durable priority-#2 destination, so the event
  // must fall through (here: to its own internal page) rather than render a
  // "durable" card/detail link to gocalaveras.com. Real case: The Stitch Lounge.
  assert.equal(
    promotableVenueUrl("The Stitch Lounge", "https://www.gocalaveras.com/events/the-stitch-lounge-summer-camp/"),
    null
  );
  assert.equal(promotableVenueUrl("Some Venue", "https://gocalaveras.com/events/x/"), null);
});

test("isMultiTenantVenue: parks/centers yes, single operators no, no false positives", () => {
  assert.equal(isMultiTenantVenue("Utica Park"), true);
  assert.equal(isMultiTenantVenue("White Pines Community Park"), true);
  assert.equal(isMultiTenantVenue("Stevenot Winery"), false);
  assert.equal(isMultiTenantVenue("The Pour House"), false);
  // \b guards against matching inside a longer word.
  assert.equal(isMultiTenantVenue("Parkside Grill"), false);
});

test("GoCalaveras event at a single-operator venue resolves to the venue (durable), not the aggregator", () => {
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "Live Music",
      venue_name: "Stevenot Winery",
      org_slug: "gocalaveras",
      event_url: "https://www.gocalaveras.com/events/live-music-stevenot/",
    }),
    ORGS,
    {
      venueUrl: promotableVenueUrl("Stevenot Winery", "https://www.stevenotwinery.com/"),
      venueName: "Stevenot Winery",
    }
  );
  assert.equal(r.kind, "venue");
  assert.equal(r.href, "https://www.stevenotwinery.com/");
  assert.equal(r.durable, true);
  assert.equal(r.label, "Visit Stevenot Winery");
});

test("GoCalaveras event at a multi-tenant park keeps the non-durable aggregator fallback", () => {
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "Vendor Fair",
      venue_name: "Murphys Community Park",
      org_slug: "gocalaveras",
      event_url: "https://www.gocalaveras.com/events/vendor-fair-9/",
    }),
    ORGS,
    { venueUrl: promotableVenueUrl("Murphys Community Park", "https://murphyspark.com/") }
  );
  assert.equal(r.kind, "source");
  assert.equal(r.durable, false);
});
