// HWY-62 locks: IndexNow submission (key resolution, batching, host filter,
// never-throw) and the qa-audit AI-crawler access check.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INDEXNOW_ENDPOINT,
  KEY_PATH,
  buildIndexNowPayloads,
  collectIndexNowUrls,
  resolveIndexNowKey,
  submitIndexNow,
} from "../../lib/indexnow.js";
import { AI_BOT_USER_AGENTS, checkPage, checkKey } from "../../lib/agent/qa-audit.js";
import { REGION_OPS } from "../../lib/region-ops.js";

const SITE = "https://hwy4events.com";
const KEY = "e230279a6359ae78c9f769ef01f51303";

test("key: env wins, region default otherwise, junk disables", () => {
  assert.equal(resolveIndexNowKey("abcdef12", KEY), "abcdef12");
  assert.equal(resolveIndexNowKey(undefined, KEY), KEY);
  assert.equal(resolveIndexNowKey("  ", KEY), KEY);
  assert.equal(resolveIndexNowKey("bad key!", undefined), null);
  assert.equal(resolveIndexNowKey("short", undefined), null, "under 8 chars is invalid");
  assert.equal(resolveIndexNowKey(undefined, undefined), null);
  assert.equal(resolveIndexNowKey(undefined, REGION_OPS.seo.indexNowKey), REGION_OPS.seo.indexNowKey);
});

test("payloads: same-host only, deduped, batched at the spec limit", () => {
  const urls = [
    `${SITE}/events/a`,
    `${SITE}/events/a`,
    "https://evil.example.com/x",
    "not a url",
    "javascript:alert(1)",
    `${SITE}/`,
  ];
  const [p] = buildIndexNowPayloads(urls, SITE, KEY);
  assert.deepEqual(p, {
    host: "hwy4events.com",
    key: KEY,
    keyLocation: `${SITE}${KEY_PATH}`,
    urlList: [`${SITE}/events/a`, `${SITE}/`],
  });
  const many = Array.from({ length: 25 }, (_, i) => `${SITE}/events/e${i}`);
  const batches = buildIndexNowPayloads(many, SITE, KEY, 10);
  assert.deepEqual(batches.map((b) => b.urlList.length), [10, 10, 5]);
  assert.deepEqual(buildIndexNowPayloads(urls, "garbage", KEY), []);
});

test("submit: posts JSON to the IndexNow endpoint and counts accepted URLs", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const res = await submitIndexNow([`${SITE}/events/a`, `${SITE}/events/b`], {
    siteUrl: SITE,
    key: KEY,
    log: () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { status: 202 };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, INDEXNOW_ENDPOINT);
  assert.equal((calls[0].body as { urlList: string[] }).urlList.length, 2);
  assert.deepEqual(res, { submitted: 2, batches: 1, statuses: [202], ok: true });
});

test("submit never throws: network errors and rejections are reported", async () => {
  const thrown = await submitIndexNow([`${SITE}/events/a`], {
    siteUrl: SITE,
    key: KEY,
    log: () => {},
    fetchImpl: async () => {
      throw new Error("ECONNRESET");
    },
  });
  assert.deepEqual(thrown, { submitted: 0, batches: 1, statuses: [0], ok: false });

  const rejected = await submitIndexNow([`${SITE}/events/a`], {
    siteUrl: SITE,
    key: KEY,
    log: () => {},
    fetchImpl: async () => ({ status: 403 }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.submitted, 0);

  const noKey = await submitIndexNow([`${SITE}/x`], { siteUrl: SITE, key: null, log: () => {} });
  assert.equal(noKey.skipped, "no_key");
  const noUrls = await submitIndexNow([], { siteUrl: SITE, key: KEY, log: () => {} });
  assert.equal(noUrls.skipped, "no_urls");
});

test("daily list: new events + hubs + towns that gained an event", () => {
  const urls = collectIndexNowUrls(
    [
      { name: "Trivia Night", date: "2026-10-09", town: "Arnold" },
      { name: "Wine Walk", date: "2026-10-10", town: "Avery" },
    ],
    SITE,
    { hubPaths: ["/", "/this-weekend"], publishedTownSlugs: new Set(["arnold"]) }
  );
  assert.deepEqual(urls, [
    `${SITE}/events/trivia-night-2026-10-09-arnold`,
    `${SITE}/events/wine-walk-2026-10-10-avery`,
    `${SITE}/`,
    `${SITE}/this-weekend`,
    `${SITE}/towns/arnold`,
  ]);
  assert.deepEqual(
    collectIndexNowUrls([], SITE, { hubPaths: ["/"], publishedTownSlugs: new Set() }),
    [],
    "no new events, nothing to push"
  );
});

test("cron wiring: daily after reconcile, key route present", () => {
  const vercel = JSON.parse(readFileSync(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8"));
  const cron = vercel.crons.find((c: { path: string }) => c.path === "/api/indexnow");
  assert.ok(cron, "indexnow cron registered");
  assert.equal(cron.schedule, "0 16 * * *");
  const route = readFileSync(fileURLToPath(new URL("../../app/api/indexnow/route.ts", import.meta.url)), "utf8");
  assert.ok(route.includes("requireCronAuth"), "cron route is CRON_SECRET-gated");
  assert.ok(route.includes('.neq("is_routine", true)'), "routine rows 404 and are never submitted");
  readFileSync(fileURLToPath(new URL("../../app/indexnow-key.txt/route.ts", import.meta.url)), "utf8");
});

test("bot access: the real page passes, walls and challenges are flagged", () => {
  const html = "<html><head><title>What's on this weekend | Hwy 4 Events</title></head></html>";
  assert.deepEqual(checkPage("bot", 200, html), []);
  for (const [status, body] of [
    [403, "Forbidden"],
    [429, ""],
    [0, ""],
    [200, "<html><title>Vercel Security Checkpoint</title></html>"],
    [200, "<html><title>Just a moment...</title></html>"],
    [200, "{}"],
  ] as const) {
    const f = checkPage("bot", status, body);
    assert.equal(f.length, 1, `${status} ${body}`);
    assert.equal(f[0].check, "bot_blocked");
    assert.match(f[0].detail, /Vercel Firewall logs/, "says to verify, since the UA is spoofed");
  }
  assert.equal(checkKey("bot_blocked", "bot:OAI-SearchBot"), "qa:bot_blocked:bot:OAI-SearchBot");
  const names = AI_BOT_USER_AGENTS.map((b) => b.name);
  for (const n of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "Bingbot", "Googlebot"]) {
    assert.ok(names.includes(n), n);
  }
});
