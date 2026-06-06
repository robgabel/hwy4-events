// Regression lock for the ONE "is this image src safe for next/image" rule
// (lib/images.ts). A remote / un-allowlisted host passed to <Image> throws at
// render time and 500s the page — catastrophic on the hourly-ISR homepage,
// which then serves a frozen cache and stops surfacing new events. Only
// same-origin absolute paths are "local" / optimizable; everything else must
// fall back to a plain <img>.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalImage } from "../../lib/images.js";

test("local public asset paths are optimizable", () => {
  assert.equal(isLocalImage("/images/live_music.svg"), true);
  assert.equal(isLocalImage("/images/ironstone.jpg"), true);
  assert.equal(isLocalImage("/millie-happy.svg"), true);
});

test("remote poster URLs are NOT local (the 500 trigger)", () => {
  // The exact failure that froze the ISR homepage.
  assert.equal(isLocalImage("https://calaverashumane.org/poster.jpg"), false);
  // Our own Supabase Storage bucket (organizer poster swaps) is still remote —
  // its host isn't in next.config.ts either, so it must take the <img> path.
  assert.equal(
    isLocalImage(
      "https://uzediwokyshjbsymevtp.supabase.co/storage/v1/object/public/event-posters/x.jpg"
    ),
    false
  );
  assert.equal(isLocalImage("http://example.com/p.png"), false);
});

test("protocol-relative URLs are treated as remote, not local", () => {
  // `//host/x.jpg` starts with "/" but resolves to a remote host — it must not
  // slip through to next/image.
  assert.equal(isLocalImage("//evil.example.com/x.jpg"), false);
});
