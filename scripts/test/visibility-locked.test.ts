// Regression lock for HWY-24: `visibility_locked`
// (migration 20260905_add_visibility_locked.sql).
//
// Why it exists. The Ebbetts Pass Moose Lodge calendar is a PDF read by an LLM,
// so every row's `visibility` is a model verdict re-derived on every Monday run.
// On 2026-08-10 two members-only gatherings were live on the public site: the
// WOTM 50th Anniversary Celebration (a free dinner for members) and a Car Show
// Setup volunteer work call. Both were fixed by hand, and both only STAYED fixed
// because their dates passed before the next scrape. Every other lock-protected
// field class had an escape hatch; visibility had none, so the correction was
// guaranteed to be overwritten. That is a privacy defect: it publishes a
// members-only gathering to the open web.
//
// Two halves are pinned here, because the exposure is asymmetric:
//
//   1. the SHARED path (scripts/lib/dedup.ts) must never write `visibility` on
//      an update at all — it is an INSERT-only field there, which is why no
//      aggregator could ever flip an existing row. Locking that keeps a future
//      "self-heal visibility" edit from quietly opening the hole.
//   2. the SELF-CONTAINED writer (/api/scrape-moose-lodge) writes its own
//      UPDATE, so it has to honor each lock itself. That route is where the
//      bug actually lived, and it has no pure core to call, so the lock is
//      structural — the same technique image-hosts.test.ts uses to pin
//      next.config.ts against the region registry.
//
// dedup.ts imports scripts/lib/supabase-admin, which throws at import time when
// the service-role env is unset, so set dummy env then dynamic-import.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

/** The body of a named function, brace-matched from its declaration. Coarse
 *  slicing (to the next top-level export) ran past the function end and read
 *  the INSERT payload that follows it, which is exactly what must NOT count. */
function functionBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  const open = src.indexOf("{", start + decl.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${decl}`);
}

const storedRow = {
  id: "e1",
  name: "WOTM 50th Anniversary Celebration",
  date: "2026-08-11",
  venue_name: "Ebbetts Pass Moose Lodge",
  description: "Free dinner for members. Check the sign-up board.",
  start_time: "17:00",
  end_time: "20:00",
  price: null,
  event_url: null,
  address: "1965 Blagen Rd, Arnold, CA 95223",
  town: "Arnold",
  image_url: null,
  category: "club",
  artists: null,
};

const rescrape = { ...storedRow, source_event_id: null };

test("the shared merge payload never carries visibility", async () => {
  const { buildStrongMatchUpdate } = await load();
  const payload = buildStrongMatchUpdate(
    storedRow as never,
    rescrape as never,
    "key",
    "2026-08-11T12:00:00.000Z"
  ) as Record<string, unknown>;
  assert.equal(
    "visibility" in payload,
    false,
    "a merge must not re-assert visibility — a members-only row would be re-published"
  );
});

test("the shared exact-match payload never carries visibility", async () => {
  const { buildExactMatchUpdate } = await load();
  const payload = buildExactMatchUpdate(
    storedRow as never,
    { ...rescrape, name: "WOTM 50th Anniversary Celebration (updated)" } as never,
    "key",
    "2026-08-11T12:00:00.000Z"
  ) as Record<string, unknown>;
  assert.equal("visibility" in payload, false);
});

// Structural guard on the shared path: `visibility` may appear in dedup.ts only
// as an INSERT field (or the function parameter it comes from). If someone adds
// it to an update payload, this fails.
test("dedup.ts writes visibility on INSERT only", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/dedup.ts", import.meta.url)),
    "utf8"
  );
  const builders = [...src.matchAll(/export function build(\w*)Update\b/g)].map((m) => m[0]);
  assert.ok(builders.length >= 2, "expected the update-payload builders to exist");

  for (const decl of builders) {
    assert.equal(
      /(^|[^_\w])visibility\s*[,:]/m.test(functionBody(src, decl)),
      false,
      `${decl} must not write visibility — it is INSERT-only on the shared path (HWY-24)`
    );
  }
});

// The route where the bug lived. Each lock it can encounter must be BOTH
// selected from the existing row AND used to drop its field from the update.
test("/api/scrape-moose-lodge honors every lock on the field it writes", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../app/api/scrape-moose-lodge/route.ts", import.meta.url)),
    "utf8"
  );

  const select = src.match(/\.select\(\s*(?:"([^"]*)"|\n?\s*"([^"]*)"\s*\n?)\s*\)/g)?.join(" ") ?? "";

  // lock column -> the payload field(s) it protects, for fields THIS route writes.
  const locks: Record<string, string[]> = {
    visibility_locked: ["visibility"],
    times_locked: ["start_time", "end_time"],
    notability_locked: ["is_routine", "routine_reason"],
    description_locked: ["description"],
    price_locked: ["price"],
  };

  for (const [lock, fields] of Object.entries(locks)) {
    assert.ok(
      select.includes(lock),
      `route must select ${lock} to be able to honor it`
    );
    assert.match(
      src,
      new RegExp(`existing\\.${lock}\\s*\\)\\s*\\{`),
      `route must branch on existing.${lock}`
    );
    for (const f of fields) {
      assert.match(
        src,
        new RegExp(`delete updateRow\\.${f}\\b`),
        `route must drop ${f} from the update payload when ${lock} is set`
      );
    }
  }
});

test("/api/scrape-moose-lodge never re-asserts curation fields on update", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../app/api/scrape-moose-lodge/route.ts", import.meta.url)),
    "utf8"
  );
  // row sets both false for the INSERT case; leaving them in the UPDATE would
  // clear a curator's Rob's Pick on the next Monday run.
  for (const f of ["robs_pick", "is_weekly"]) {
    assert.match(src, new RegExp(`delete updateRow\\.${f}\\b`), `${f} must be dropped from the update`);
  }
});
