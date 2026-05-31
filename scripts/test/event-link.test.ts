// Regression lock for the ONE "where does this event link to" rule
// (lib/event-link.ts). The destination must come from event identity
// (organizer/venue), never from a churning aggregator permalink.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEventLink,
  resolveEventLinkFromOrgs,
  matchOrgForEvent,
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
  canonical_url: "https://www.parks.ca.gov/?page_id=25994",
  match_patterns: ["big trees", "calaveras big trees"],
};
const GOCAL: LinkOrg = {
  slug: "gocalaveras",
  display_name: "GoCalaveras.com",
  canonical_url: null,
  match_patterns: null,
};
const ORGS = [ART, BIGTREES, GOCAL];

test("organizer canonical wins over a (dead) GoCalaveras event_url", () => {
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
  assert.equal(r.href, "https://www.parks.ca.gov/?page_id=25994");
  assert.equal(r.durable, true);
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

test("GoCalaveras-only event with no matching org → no outbound CTA", () => {
  const r = resolveEventLinkFromOrgs(
    ev({
      name: "Some Random Vendor Fair",
      venue_name: "Murphys Community Park",
      org_slug: "gocalaveras",
      event_url: "https://www.gocalaveras.com/events/some-random-vendor-fair-7/",
    }),
    ORGS
  );
  assert.equal(r.kind, "none");
  assert.equal(r.href, null);
});

test("stable-host event_url (Visit Murphys) renders as a source link", () => {
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

test("www. and bare gocalaveras.com are both suppressed", () => {
  for (const url of [
    "https://gocalaveras.com/events/x/",
    "https://www.gocalaveras.com/events/x/",
  ]) {
    assert.equal(resolveEventLink(ev({ name: "x", event_url: url })).kind, "none");
  }
});

test("unparseable event_url → none", () => {
  assert.equal(resolveEventLink(ev({ name: "x", event_url: "not a url" })).kind, "none");
});
