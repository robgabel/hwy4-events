// Regression lock for the JSON-LD serializer (lib/json-ld.ts).
//
// JSON.stringify does not escape "<", so scraped event data containing
// "</script><script>…" could break out of a <script type="application/ld+json">
// block and execute (stored XSS — Eugene fork security review, 2026-07-02).
// This suite pins the one serializer every ld+json sink must use.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeJsonLd } from "../../lib/json-ld.js";

test("a </script> payload cannot close the script tag", () => {
  const payload = 'Trivia Night</script><script>alert(1)</script>';
  const out = serializeJsonLd({ name: payload });
  assert.ok(!out.includes("</script"), "raw </script must never survive");
  assert.ok(!out.includes("<script"), "raw <script must never survive");
  assert.ok(out.includes("\\u003c/script"), "escaped form expected");
});

test("escaped output is still valid JSON that round-trips exactly", () => {
  const data = {
    name: '<b>Live Music @ The Lube Room</b> "special" \\ night',
    nested: { artists: ["</script>", "B-Side"] },
  };
  const out = serializeJsonLd(data);
  assert.deepEqual(JSON.parse(out), data);
});

test("plain data is unchanged from JSON.stringify", () => {
  const data = { name: "Frog Jump", price: 0, free: true, when: null };
  assert.equal(serializeJsonLd(data), JSON.stringify(data));
});
