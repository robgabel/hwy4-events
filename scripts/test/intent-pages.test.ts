// Regression lock for the intent landing pages (lib/intent-pages.ts).
//
// Two things are load-bearing: the lens filters (what qualifies as "free" or
// "date night" — both are honesty claims the copy makes out loud), and the
// fixed editorial copy's voice rules (no em dashes; every Q&A answer resolves
// in its first sentence, so answer engines can lift it).
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFreeEvent,
  isDateNightEvent,
  INTENT_CONFIG,
  DATE_NIGHT_EARLIEST,
} from "../../lib/intent-pages.js";

test("free lens: stated-free public events only", () => {
  assert.ok(isFreeEvent({ cost_tier: "free", visibility: "public" }));
  // unknown is NOT free — mirrors the extract-prices never-guess policy
  assert.ok(!isFreeEvent({ cost_tier: "unknown", visibility: "public" }));
  assert.ok(!isFreeEvent({ cost_tier: "paid", visibility: "public" }));
  assert.ok(!isFreeEvent({ cost_tier: "free", visibility: "private" }));
});

test("date-night lens: evening events in the right categories", () => {
  const base = { visibility: "public" as const };
  assert.ok(
    isDateNightEvent({ ...base, category: "live_music", start_time: "19:00:00" })
  );
  assert.ok(
    isDateNightEvent({ ...base, category: "wine", start_time: "17:30:00" })
  );
  assert.ok(
    isDateNightEvent({ ...base, category: "festival", start_time: "18:00:00" })
  );
  // boundary: 16:30 is in, 16:29 is out
  assert.ok(
    isDateNightEvent({ ...base, category: "fine_arts", start_time: DATE_NIGHT_EARLIEST })
  );
  assert.ok(
    !isDateNightEvent({ ...base, category: "fine_arts", start_time: "16:29:00" })
  );
  // no start time = no evening claim
  assert.ok(!isDateNightEvent({ ...base, category: "live_music", start_time: null }));
  // wrong category / visibility
  assert.ok(!isDateNightEvent({ ...base, category: "kids", start_time: "18:00:00" }));
  assert.ok(
    !isDateNightEvent({ category: "live_music", start_time: "19:00:00", visibility: "private" })
  );
});

test("configs are coherent (paths, windows, filters wired)", () => {
  for (const cfg of Object.values(INTENT_CONFIG)) {
    assert.ok(cfg.path.startsWith("/"), `${cfg.key} path`);
    assert.ok(cfg.windowDays > 0, `${cfg.key} window`);
    assert.equal(typeof cfg.filter, "function");
    assert.ok(cfg.editorial.length >= 1);
    assert.ok(cfg.qa.length >= 1);
  }
});

test("voice lock: no em dashes anywhere in the fixed copy", () => {
  for (const cfg of Object.values(INTENT_CONFIG)) {
    const strings = [
      cfg.h1,
      cfg.lead,
      cfg.metaTitle,
      cfg.metaDescription,
      ...cfg.editorial,
      ...cfg.qa.flatMap((x) => [x.q, x.a]),
    ];
    for (const s of strings) {
      assert.ok(!s.includes("—"), `em dash in ${cfg.key}: "${s.slice(0, 60)}"`);
    }
  }
});

test("every Q&A answer resolves in its first sentence (liftable)", () => {
  for (const cfg of Object.values(INTENT_CONFIG)) {
    for (const { q, a } of cfg.qa) {
      const first = a.split(". ")[0];
      assert.ok(
        first.length >= 20,
        `${cfg.key} answer to "${q}" opens too thin: "${first}"`
      );
    }
  }
});
