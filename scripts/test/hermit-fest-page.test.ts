// Lock for HWY-53: the Hermit Fest event page that Search Console ranks for
// both spellings gets a two-word title, a two-word H1, and one plain answer
// line. Every other slug, including the other Hermitfest rows, stays untouched.
//
// Run: `cd scripts && npx tsx --test test/hermit-fest-page.test.ts`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HERMIT_FEST_RANKING_SLUG,
  hermitFestPageSeo,
} from "../../lib/hermit-fest-page.js";
import { generateEventSlug } from "../../lib/slugs.js";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/events/[slug]/page.tsx", import.meta.url)),
  "utf8"
);

test("the ranking slug is the music-festival row Search Console is showing", () => {
  assert.equal(
    generateEventSlug(
      "Hermitfest West – Music Festival",
      "2026-09-13",
      "Bear Valley"
    ),
    HERMIT_FEST_RANKING_SLUG
  );
});

test("that page's title carries both spellings, and the H1 is the two-word query", () => {
  const seo = hermitFestPageSeo(HERMIT_FEST_RANKING_SLUG);
  assert.ok(seo);
  assert.equal(
    seo.title,
    "Hermit Fest 2026 (Hermitfest) - September 12-13, 2026, Highway 4 Corridor"
  );
  assert.match(seo.title, /Hermit Fest 2026/);
  assert.match(seo.title, /\(Hermitfest\)/);
  assert.match(seo.title, /Highway 4 Corridor/);
  assert.equal(seo.h1, "Hermit Fest 2026");
  assert.equal(seo.h1.includes("Hermitfest"), false);
  assert.ok(!seo.title.includes("—") && !seo.h1.includes("—"));
});

test("the line under the H1 answers when and where, in one sentence", () => {
  const seo = hermitFestPageSeo(HERMIT_FEST_RANKING_SLUG);
  assert.ok(seo);
  assert.match(seo.whenLine, /Saturday, September 12/);
  assert.match(seo.whenLine, /Sunday, September 13/);
  assert.match(seo.whenLine, /Grizzly Ballfield/);
  assert.match(seo.whenLine, /Bear Valley/);
  assert.ok(!seo.whenLine.includes("—"));
  assert.ok(!seo.whenLine.includes("?"), "the line answers; it does not ask");
  assert.equal(seo.whenLine.split(/(?<=\.)\s/).length, 1);
});

test("sibling Hermitfest pages and the hub are left alone", () => {
  assert.equal(hermitFestPageSeo("hermitfest-west-2026-09-12-bear-valley"), null);
  assert.equal(hermitFestPageSeo("hermitfest-west-2026-09-13-bear-valley"), null);
  assert.equal(
    hermitFestPageSeo("hermitfest-west-lodge-special-2026-09-11-bear-valley"),
    null
  );
  assert.equal(hermitFestPageSeo("hermitfest"), null);
  assert.equal(hermitFestPageSeo(""), null);
});

test("the event page applies the override to the title tag and the H1 only", () => {
  assert.ok(pageSource.includes('from "@/lib/hermit-fest-page"'));
  assert.equal(pageSource.split("hermitFestPageSeo(").length - 1, 2);
  assert.match(pageSource, /title: hermitSeo \? \{ absolute: hermitSeo\.title \} : title/);
  assert.match(
    pageSource,
    /\{hermitSeo\?\.h1 \?\? concoursPage\?\.h1 \?\? event\.name\}/,
  );
  assert.match(pageSource, /\{hermitSeo\.whenLine\}/);
});
