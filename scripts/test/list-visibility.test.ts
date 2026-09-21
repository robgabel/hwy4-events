// HWY-45: members-only and routine club rows must not render as cards unless
// a club is opted in, and a routine row must not render even then (its detail
// page 404s).
//
// The shared fetch used to keep private rows that were also is_routine, and
// only the homepage applied an enabledOrgs gate. Temporal, stay-range, and
// town pages rendered that set raw, so a host link showed a lodge Breakfast
// whose detail page 404'd.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  filterListableEvents,
  isListableEvent,
} from "../../lib/list-visibility.js";

type Row = {
  id: string;
  name: string;
  visibility: "public" | "private";
  org_slug: string | null;
  is_routine: boolean;
  town: string;
};

// Shape of the shared upcoming fetch BEFORE the list gate, including the
// routine-private rows the old `is_routine OR private` clause let through.
const FEED: Row[] = [
  {
    id: "public-market",
    name: "Arnold Farmers Market",
    visibility: "public",
    org_slug: null,
    is_routine: false,
    town: "Arnold",
  },
  {
    id: "b27f9d27-0ab8-4693-975b-7f638c1a4edd",
    name: "Breakfast",
    visibility: "private",
    org_slug: "moose-lodge",
    is_routine: true,
    town: "Arnold",
  },
  {
    id: "2695287d-d32b-4ed3-9a71-d4252b48532a",
    name: "SWCC Men's Match Play #3",
    visibility: "private",
    org_slug: "sequoia-woods",
    is_routine: false,
    town: "Arnold",
  },
  {
    id: "public-dinner",
    name: "Thursday Night Dinner",
    visibility: "public",
    org_slug: "sequoia-woods",
    is_routine: true,
    town: "Arnold",
  },
  {
    id: "other-town-private",
    name: "Members Social",
    visibility: "private",
    org_slug: "blue-lake-springs",
    is_routine: false,
    town: "Arnold",
  },
];

const NO_CLUBS = new Set<string>();

// Each list surface's filter over the shared feed. Homepage uses the
// predicate inside its broader filter; the others call filterListableEvents.
const viewFilters: Record<string, (rows: Row[]) => Row[]> = {
  temporal: (rows) => filterListableEvents(rows, NO_CLUBS),
  town: (rows) =>
    filterListableEvents(
      rows.filter((row) => row.town === "Arnold"),
      NO_CLUBS
    ),
  homepage: (rows) => rows.filter((row) => isListableEvent(row, NO_CLUBS)),
  simpleList: (rows) => filterListableEvents(rows),
};

test("no private row survives a list filter when no club is opted in", () => {
  for (const [view, filter] of Object.entries(viewFilters)) {
    const shown = filter(FEED);
    const leaked = shown.filter((row) => row.visibility === "private");
    assert.deepEqual(
      leaked.map((row) => row.id),
      [],
      `${view} leaked members-only rows with empty enabledOrgs`
    );
    assert.deepEqual(
      shown.map((row) => row.id),
      ["public-market"]
    );
  }
});

test("no routine row survives any list filter, including an opted-in club", () => {
  const clubs = new Set(["moose-lodge", "sequoia-woods", "blue-lake-springs"]);
  const surfaces = [
    filterListableEvents(FEED, clubs),
    FEED.filter((row) => isListableEvent(row, clubs)),
    filterListableEvents(FEED, new Set(["moose-lodge"])),
  ];
  for (const shown of surfaces) {
    assert.equal(
      shown.some((row) => row.is_routine === true),
      false,
      `routine row survived: ${shown.map((row) => row.name).join(", ")}`
    );
  }
});

test("opting into a club shows that club's non-routine private rows only", () => {
  const sequoia = new Set(["sequoia-woods"]);
  const shown = filterListableEvents(FEED, sequoia);
  assert.deepEqual(
    shown.map((row) => row.name).sort(),
    ["Arnold Farmers Market", "SWCC Men's Match Play #3"]
  );
  // Homepage predicate matches the shared helper.
  assert.deepEqual(
    FEED.filter((row) => isListableEvent(row, sequoia)).map((row) => row.id),
    shown.map((row) => row.id)
  );
});

test("a private row with no org_slug stays hidden even if some club is on", () => {
  const row: Row = {
    id: "unkeyed",
    name: "Mystery Members Night",
    visibility: "private",
    org_slug: null,
    is_routine: false,
    town: "Murphys",
  };
  assert.equal(isListableEvent(row, new Set(["moose-lodge"])), false);
  assert.equal(isListableEvent(row, NO_CLUBS), false);
});

function readRepo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("the shared fetch drops routine rows with no private exemption", () => {
  const src = readRepo("../../lib/events-data.ts");
  assert.match(src, /\.neq\("is_routine", true\)/);
  assert.doesNotMatch(
    src,
    /visibility\.eq\.private/,
    "the private exemption on the routine hide is what let 404 cards onto lists"
  );
  assert.match(
    src,
    /filterListableEvents\([\s\S]*?\)\.slice\(0, limit\)/,
    "getEventsInTown must gate before the cap so private rows cannot crowd it"
  );
});

test("temporal, town, homepage, and SimpleEventList all call the shared gate", () => {
  const temporal = readRepo("../../components/TemporalEventsView.tsx");
  const town = readRepo("../../app/towns/[slug]/page.tsx");
  const homepage = readRepo("../../components/EventList.tsx");
  const simple = readRepo("../../components/SimpleEventList.tsx");

  assert.match(temporal, /filterListableEvents\(inRange\)/);
  assert.match(town, /filterListableEvents\(townEvents\)/);
  assert.match(homepage, /isListableEvent\(e, enabledOrgs\)/);
  assert.match(simple, /filterListableEvents\(events, enabledOrgs\)/);
});
