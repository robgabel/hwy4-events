// Locks the next/image host-routing that keeps an unconfigured image host from
// 500-ing the page: local + allowlisted-https srcs optimize, everything else
// falls back to a plain <img>. Plus a drift guard — every optimizable host must
// actually be configured in next.config.ts remotePatterns. Pure, no DOM/DB.
// Run: cd scripts && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { canOptimizeImage, OPTIMIZED_IMAGE_HOSTS } from "../../lib/image-hosts.js";
import nextConfig from "../../next.config.js";

test("local asset paths optimize", () => {
  assert.equal(canOptimizeImage("/images/live_music.svg"), true);
  assert.equal(canOptimizeImage("/posters/sierra-nevada-arts-crafts-festival-2026.jpg"), true);
});

test("allowlisted https hosts optimize", () => {
  assert.equal(canOptimizeImage("https://www.gocalaveras.com/x.jpg"), true);
  assert.equal(canOptimizeImage("https://visitmurphys.com/x.jpg"), true);
  assert.equal(canOptimizeImage("https://hwy4events.com/event-posters/greg-sutton.jpg"), true);
});

test("external / unconfigured hosts fall back to plain <img> (the crash this fixes)", () => {
  assert.equal(canOptimizeImage("https://ironstonevineyards.com/wp-content/uploads/x.jpg"), false);
  assert.equal(canOptimizeImage("https://calaverashumane.org/x.jpeg"), false);
});

test("http:// is not optimizable — remotePatterns require https", () => {
  assert.equal(canOptimizeImage("http://www.gocalaveras.com/x.jpg"), false);
});

test("unparseable / empty srcs fall back safely", () => {
  assert.equal(canOptimizeImage("not a url"), false);
  assert.equal(canOptimizeImage(""), false);
});

// Drift guard: anything we mark optimizable MUST be in next.config.ts
// remotePatterns, or next/image throws at render for it.
test("OPTIMIZED_IMAGE_HOSTS ⊆ next.config remotePatterns", () => {
  const configured = new Set(
    (nextConfig.images?.remotePatterns ?? []).map((p) => p.hostname)
  );
  for (const host of OPTIMIZED_IMAGE_HOSTS) {
    assert.ok(
      configured.has(host),
      `"${host}" is optimizable but missing from next.config.ts remotePatterns — would 500`
    );
  }
});
