import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nameRoot,
  placeAnchor,
  generateDedupKey,
  mergeEventFields,
  DEDUP_KEY_VERSION,
} from "./dedup.js";

test("DEDUP_KEY_VERSION is a positive integer", () => {
  assert.ok(Number.isInteger(DEDUP_KEY_VERSION) && DEDUP_KEY_VERSION > 0);
});

test("nameRoot collapses dash variants and casing", () => {
  assert.equal(nameRoot("Henry V – Matinee"), "henry v - matinee");
  assert.equal(nameRoot("Henry V — Matinee"), "henry v - matinee");
  assert.equal(nameRoot("HENRY V – MATINEE"), "henry v - matinee");
});

test("nameRoot strips trailing parenthetical noise", () => {
  assert.equal(
    nameRoot("Bear Valley Music Festival (through Aug 2)"),
    "bear valley music festival"
  );
  assert.equal(nameRoot("Bear Valley Music Festival"), "bear valley music festival");
});

test("nameRoot strips trailing 'at <venue>' / '@ <venue>'", () => {
  assert.equal(nameRoot("Coffee & Cars at the Lodge"), "coffee & cars");
  assert.equal(nameRoot("Bird Walk @ Big Trees State Park"), "bird walk");
});

test("nameRoot strips leading 'Free ' and 'The '", () => {
  assert.equal(nameRoot("Free Coffee & Cars Car Show"), "coffee & cars car show");
  assert.equal(nameRoot("The Big Show"), "big show");
});

test("placeAnchor prefers address over venue and town", () => {
  const a = placeAnchor("1170 East Highway 4, Arnold, CA 95223", "Big Trees State Park", "Dorrington");
  const b = placeAnchor("1170 East Highway 4, Arnold, CA 95223", "Unknown Venue", "Avery");
  assert.equal(a, b, "address dominates regardless of venue/town variants");
});

test("placeAnchor resolves known-venue aliases to the same slug", () => {
  const a = placeAnchor(null, "Big Trees State Park", "Arnold");
  const b = placeAnchor(null, "Calaveras Big Trees State Park", "Dorrington");
  assert.equal(a, b);
  assert.ok(a.startsWith("venue:"));
});

test("placeAnchor falls back to town when neither address nor known venue", () => {
  const a = placeAnchor(null, "Unknown Venue", "Murphys");
  assert.equal(a, "town:murphys");
});

test("placeAnchor returns empty string when nothing is usable", () => {
  assert.equal(placeAnchor(null, null, null), "");
  assert.equal(placeAnchor(null, "Unknown Venue", ""), "");
});

test("generateDedupKey collapses town-drift dupes when address matches", () => {
  const k1 = generateDedupKey(
    "Big Trees State Park – North Grove Guided Hike",
    "2026-06-20",
    "Arnold",
    "1170 East Highway 4, Arnold, CA 95223",
    "Big Trees State Park"
  );
  const k2 = generateDedupKey(
    "Big Trees State Park – North Grove Guided Hike",
    "2026-06-20",
    "Dorrington", // wrong town
    "1170 East Highway 4, Arnold, CA 95223",
    "Calaveras Big Trees State Park" // richer venue name
  );
  assert.equal(k1, k2);
});

test("generateDedupKey collapses town-drift dupes via known venue when address is missing", () => {
  const k1 = generateDedupKey(
    "Bird Walk @ Big Trees State Park",
    "2026-05-28",
    "Arnold",
    null,
    "Big Trees State Park"
  );
  const k2 = generateDedupKey(
    "Bird Walk @ Big Trees State Park",
    "2026-05-28",
    "Dorrington",
    null,
    "Big Trees State Park"
  );
  assert.equal(k1, k2);
});

test("generateDedupKey collapses 'Henry V – Matinee' identical-name regression", () => {
  // The original prod bug: two byte-identical rows hashed to different keys
  // because the normalizer changed. Pinning the formula via DEDUP_KEY_VERSION
  // means a single rehash migration restores collision.
  const k1 = generateDedupKey("Henry V – Matinee", "2026-06-14", "Murphys", null, "Murphys Creek Theatre");
  const k2 = generateDedupKey("Henry V – Matinee", "2026-06-14", "Murphys", null, "Murphys Creek Theatre");
  assert.equal(k1, k2);
});

test("generateDedupKey collapses 'Bear Valley Music Festival' regardless of trailing date qualifier", () => {
  const k1 = generateDedupKey(
    "Bear Valley Music Festival (through Aug 2)",
    "2026-08-02",
    "Bear Valley",
    null,
    "Bear Valley Mountain Resort"
  );
  const k2 = generateDedupKey(
    "Bear Valley Music Festival",
    "2026-08-02",
    "Bear Valley",
    null,
    "Bear Valley Mountain Resort"
  );
  assert.equal(k1, k2);
});

test("mergeEventFields never replaces a real address with NULL", () => {
  const existing = {
    name: "x",
    venue_name: "Calaveras Big Trees State Park",
    address: "1170 East Highway 4, Arnold, CA 95223",
    description: "Long description from previous scrape",
    start_time: "10:00",
    end_time: "12:00",
    price: "Free",
    event_url: "https://example.com/a",
  };
  const incoming = {
    name: "x",
    venue_name: null,
    address: null,
    description: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
  };
  const { merged, changed } = mergeEventFields(existing, incoming);
  assert.equal(merged.address, existing.address);
  assert.equal(merged.venue_name, existing.venue_name);
  assert.equal(merged.description, existing.description);
  assert.equal(changed, false);
});

test("mergeEventFields upgrades generic venue to specific venue", () => {
  const existing = {
    name: "x",
    venue_name: "Unknown Venue",
    address: null,
    description: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
  };
  const incoming = {
    name: "x",
    venue_name: "Calaveras Big Trees State Park",
    address: "1170 East Highway 4, Arnold, CA 95223",
    description: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
  };
  const { merged, changed } = mergeEventFields(existing, incoming);
  assert.equal(merged.venue_name, "Calaveras Big Trees State Park");
  assert.equal(merged.address, "1170 East Highway 4, Arnold, CA 95223");
  assert.equal(changed, true);
});

test("mergeEventFields prefers newest non-null start_time", () => {
  const existing = {
    name: "x",
    venue_name: null,
    address: null,
    description: null,
    start_time: "10:00",
    end_time: null,
    price: null,
    event_url: null,
  };
  const incoming = {
    name: "x",
    venue_name: null,
    address: null,
    description: null,
    start_time: "11:00",
    end_time: null,
    price: null,
    event_url: null,
  };
  const { merged } = mergeEventFields(existing, incoming);
  assert.equal(merged.start_time, "11:00");
});

test("mergeEventFields keeps longer description", () => {
  const existing = {
    name: "x",
    venue_name: null,
    address: null,
    description: "Short.",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
  };
  const incoming = {
    name: "x",
    venue_name: null,
    address: null,
    description:
      "Much longer and more useful description that the scraper picked up on this pass.",
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
  };
  const { merged } = mergeEventFields(existing, incoming);
  assert.equal(merged.description, incoming.description);
});

test("mergeEventFields canonical name is preserved", () => {
  const existing = {
    name: "Henry V – Matinee",
    venue_name: null,
    address: null,
    description: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
  };
  const incoming = {
    name: "Henry V Matinee",
    venue_name: null,
    address: null,
    description: null,
    start_time: null,
    end_time: null,
    price: null,
    event_url: null,
  };
  const { merged } = mergeEventFields(existing, incoming);
  assert.equal(merged.name, "Henry V – Matinee");
});
