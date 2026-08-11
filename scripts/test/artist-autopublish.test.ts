// Locks lib/agent/artist-autopublish.ts — the band-blurb auto-publish policy
// (standing rule — Rob, 2026-08-11): HIGH confidence with prose publishes and
// informs; medium and below wait for a human Save. Also locks the two halves
// of the write: the pending draft is consumed like a human Save, while
// blurb_draft_meta is deliberately KEPT (with an auto_published_at marker) so
// an unreviewed publish retains its evidence — safe because /admin/artists
// treats a row with `blurb` set as published, never pending.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoPublishColumns,
  shouldAutoPublishArtist,
} from "../../lib/agent/artist-autopublish.js";
import { BANNED_PHRASES, findBannedPhrase } from "../../lib/voice.js";

const research = (over: Record<string, unknown> = {}) => ({
  blurb: "Two sentences of local voice about the act.",
  genre: "Classic rock covers",
  hometown: "Murphys, CA",
  isLocal: true,
  links: { website: "https://example-band.com" },
  confidence: "high" as const,
  notes: null,
  sources: [{ title: "Band site", url: "https://example-band.com" }],
  ...over,
});

test("only high confidence WITH prose auto-publishes", () => {
  assert.equal(shouldAutoPublishArtist(research()), true);
  // High confidence but the coercion floor stripped the prose → nothing to publish.
  assert.equal(shouldAutoPublishArtist(research({ blurb: null })), false);
  // Medium and below always wait for a human, prose or not.
  assert.equal(shouldAutoPublishArtist(research({ confidence: "medium" })), false);
  assert.equal(shouldAutoPublishArtist(research({ confidence: "low" })), false);
});

test("autoPublishColumns: live fields set, draft consumed, provenance kept", () => {
  const now = "2026-08-11T06:00:00.000Z";
  const cols = autoPublishColumns(research(), now);
  assert.equal(cols.blurb, "Two sentences of local voice about the act.");
  assert.equal(cols.genre, "Classic rock covers");
  assert.equal(cols.blurb_generated_at, now);
  assert.deepEqual(cols.links, { website: "https://example-band.com" });
  assert.equal(cols.hometown, "Murphys, CA");
  assert.equal(cols.is_local, true);
  assert.equal(cols.blurb_draft, null);
  assert.equal(cols.blurb_draft_at, now);
  assert.equal(cols.updated_at, now);
  // The evidence behind an UNREVIEWED publish survives at rest, marked as such.
  assert.equal(cols.blurb_draft_meta.auto_published_at, now);
  assert.equal(cols.blurb_draft_meta.confidence, "high");
  assert.deepEqual(cols.blurb_draft_meta.sources, [
    { title: "Band site", url: "https://example-band.com" },
  ]);
});

test("the shared banned-phrase floor guards the unattended path", () => {
  // One list for both drafters (lib/voice.ts) — the internal-tooling leak class
  // and the marketing-brochure class both stay covered.
  assert.ok(BANNED_PHRASES.includes("knowledge base"));
  assert.ok(BANNED_PHRASES.includes("hidden gem"));
  assert.equal(findBannedPhrase("A Hidden Gem on Main Street."), "hidden gem");
  assert.equal(findBannedPhrase("Per the Knowledge Base, they play Fridays."), "knowledge base");
  assert.equal(
    findBannedPhrase("They play originals and covers most Fridays at the pub."),
    null
  );
});

test("autoPublishColumns nulls empties instead of publishing them", () => {
  const cols = autoPublishColumns(
    research({ genre: null, links: {}, hometown: null, isLocal: false }),
    "2026-08-11T06:00:00.000Z"
  );
  assert.equal(cols.genre, null);
  assert.equal(cols.links, null); // an empty links object must not overwrite with {}
  assert.equal(cols.hometown, null);
  assert.equal(cols.is_local, false);
});
