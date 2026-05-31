import { describe, it, expect } from "vitest";
import {
  dedupeEvents,
  mergeCluster,
  type DedupableEvent,
} from "../../lib/dedupe-events";

// Same venue, date, and exact time slot — the real Bistro Espresso shape where
// the aggregator lists the umbrella series and the venue feed lists the band.
const slot = {
  date: "2026-06-13",
  town: "Arnold",
  venue_name: "Bistro Espresso",
  start_time: "18:00",
  end_time: "21:00",
  visibility: "public" as const,
};

const umbrella: DedupableEvent = {
  ...slot,
  name: "Bistro Summer Concerts Series",
  description:
    "Summer concert season is back. Live music every Saturday 6-9 PM, smoky BBQ.",
  artists: null,
  image_url: "https://example.com/poster.jpg",
  source_event_id: "192236",
  event_url: "https://gocalaveras.com/event/192236",
};

const act: DedupableEvent = {
  ...slot,
  name: "Avalon Revival",
  description: null,
  artists: ["Avalon Revival"],
  image_url: "https://example.com/band.jpg",
};

describe("dedupeEvents — umbrella series + act", () => {
  it("collapses the pair to a single card", () => {
    expect(dedupeEvents([umbrella, act])).toHaveLength(1);
    expect(dedupeEvents([act, umbrella])).toHaveLength(1);
  });

  it("keeps the band name and its photo, backfills the blurb", () => {
    const [card] = dedupeEvents([umbrella, act]);
    expect(card.name).toBe("Avalon Revival");
    expect(card.image_url).toBe("https://example.com/band.jpg");
    expect(card.description).toContain("Summer concert season");
    expect(card.artists).toEqual(["Avalon Revival"]);
  });

  it("does not mutate the input rows", () => {
    dedupeEvents([umbrella, act]);
    expect(act.description).toBeNull();
    expect(umbrella.name).toBe("Bistro Summer Concerts Series");
  });
});

describe("mergeCluster", () => {
  it("returns the row unchanged for a singleton", () => {
    expect(mergeCluster([act])).toBe(act);
  });

  it("leaves genuinely different shows alone (different venue)", () => {
    const elsewhere: DedupableEvent = {
      ...act,
      venue_name: "Cameo Plaza",
      name: "Snarky Cats",
      artists: ["Snarky Cats"],
    };
    expect(dedupeEvents([act, elsewhere])).toHaveLength(2);
  });
});
