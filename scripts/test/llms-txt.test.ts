// HWY-63 locks: /llms.txt is generated from the same core-page registry as
// /sitemap-core.xml, covers every URL family, and follows the voice rules.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { corePages, type CoreFamily } from "../../lib/core-pages.js";
import { LLMS_SECTIONS, renderLlmsTxt } from "../../lib/llms-txt.js";

const INPUT = {
  towns: [
    { slug: "arnold", name: "Arnold" },
    { slug: "murphys", name: "Murphys" },
  ],
  venues: [{ slug: "ironstone-vineyards", name: "Ironstone Vineyards" }],
};
const SITE = "https://hwy4events.com";
const ALL_FAMILIES: CoreFamily[] = [
  "home",
  "temporal",
  "town",
  "intent",
  "live-music",
  "holiday",
  "market",
  "meet-me",
  "persona-hub",
  "festival",
  "venue",
  "static",
];

const pages = corePages(INPUT);
const txt = renderLlmsTxt({ siteName: "Hwy 4 Events", siteUrl: SITE, pages });
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("every core-page family is present and every section is declared", () => {
  const present = new Set(pages.map((p) => p.family));
  for (const f of ALL_FAMILIES) assert.ok(present.has(f), `family ${f} missing from corePages`);
  const declared = new Set(LLMS_SECTIONS.flatMap((s) => s.families));
  for (const f of ALL_FAMILIES) assert.ok(declared.has(f), `family ${f} has no llms.txt section`);
});

test("llms.txt lists every core page URL exactly once", () => {
  const paths = pages.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length, "core page paths are unique");
  for (const p of pages) {
    const url = p.path === "/" ? `${SITE}/` : `${SITE}${p.path}`;
    const hits = txt.split("\n").filter((l) => l.includes(`](${url})`));
    assert.equal(hits.length, 1, `${url} listed once`);
  }
});

test("the hub pages the ticket named are all there", () => {
  for (const path of [
    "/this-weekend",
    "/live-music",
    "/things-to-do",
    "/free",
    "/date-night",
    "/towns/arnold",
    "/venues/ironstone-vineyards",
    "/arnold-4th-of-july",
    "/murphys-farmers-market",
    "/hermitfest",
    "/arnold-car-show",
    "/brice-station-concerts",
    "/meet-me-in-murphys",
  ]) {
    assert.ok(txt.includes(`${SITE}${path})`), `${path} in llms.txt`);
  }
});

test("each page has a one-line answer and the file has no em dashes", () => {
  for (const p of pages) {
    assert.ok(p.answers.trim().length > 20, `${p.path} answers line`);
    assert.ok(!p.answers.includes("\n"), `${p.path} answers is one line`);
  }
  assert.ok(!txt.includes("—"), "no em dashes in llms.txt");
});

test("sitemap-core and llms.txt both read the shared registry", () => {
  const sitemap = read("../../app/sitemap-core.xml/route.ts");
  const llms = read("../../app/llms.txt/route.ts");
  for (const src of [sitemap, llms]) {
    assert.ok(src.includes("corePages(await getCorePageInput())"));
  }
  assert.equal(
    existsSync(fileURLToPath(new URL("../../public/llms.txt", import.meta.url))),
    false,
    "a static public/llms.txt would shadow the generated route"
  );
});

test("sitemap priorities and freshness policy are unchanged", () => {
  const by = (path: string) => pages.find((p) => p.path === path)!;
  assert.deepEqual([by("/").priority, by("/").live], [1, true]);
  assert.equal(by("/this-weekend").priority, 0.9);
  assert.equal(by("/towns/arnold").priority, 0.9);
  assert.equal(by("/free").priority, 0.8);
  assert.equal(by("/venues/ironstone-vineyards").priority, 0.7);
  assert.deepEqual([by("/about").priority, by("/about").live], [0.7, false]);
  assert.deepEqual([by("/faq").priority, by("/faq").live], [0.6, false]);
  assert.equal(pages[pages.length - 1].path, "/faq");
});
