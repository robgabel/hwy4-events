// Locks the nightly link check (scripts/lib/url-check.ts + validate-urls.ts).
//
// 2026-09-28: visitmurphys.com timed out from the GitHub runner for one run
// and the checker nulled every one of its 135 links, plus 4 more from hosts
// that also failed to answer. Only a 404/410 that a GET confirms may null a
// link now; anything else is kept and reported. These tests assert what must
// be KEPT as hard as what gets nulled.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLinkStatus,
  confirmedVerdict,
  planLinkNulls,
  summarizeUnconfirmed,
  linkHost,
  type LinkCheck,
} from "../lib/url-check";

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test("only 404 and 410 say a page is gone", () => {
  assert.equal(classifyLinkStatus(404), "dead");
  assert.equal(classifyLinkStatus(410), "dead");
});

test("no answer, walls, rate limits, refused HEADs and outages never read as dead", () => {
  for (const s of [null, 400, 401, 403, 405, 429, 451, 500, 502, 503, 504]) {
    assert.equal(classifyLinkStatus(s), "unconfirmed", `status ${s}`);
  }
});

test("2xx and 3xx are fine", () => {
  for (const s of [200, 204, 301, 302, 304]) {
    assert.equal(classifyLinkStatus(s), "ok", `status ${s}`);
  }
});

test("a HEAD 404 is believed only when a GET agrees", () => {
  assert.equal(confirmedVerdict(404, 404), "dead");
  assert.equal(confirmedVerdict(410, 404), "dead");
  assert.equal(confirmedVerdict(404, 200), "ok", "server that 404s HEAD but serves GET");
  assert.equal(confirmedVerdict(404, null), "unconfirmed", "GET got no answer");
  assert.equal(confirmedVerdict(404, 503), "unconfirmed");
  // The GET status is irrelevant when the HEAD didn't say dead.
  assert.equal(confirmedVerdict(null, 404), "unconfirmed");
  assert.equal(confirmedVerdict(200, 404), "ok");
  assert.equal(confirmedVerdict(503, null), "unconfirmed");
});

test("linkHost groups www and bare hosts, and survives junk", () => {
  assert.equal(linkHost("https://www.Example.com/a"), "example.com");
  assert.equal(linkHost("https://example.com/b"), "example.com");
  assert.equal(linkHost("not a url"), "");
});

const check = (
  url: string,
  verdict: LinkCheck["verdict"],
  status: number | null,
  i = 0
): LinkCheck => ({ id: `${url}#${i}`, name: `Event ${i}`, url, status, verdict });

test("the 2026-09-28 run nulls nothing", () => {
  const checks: LinkCheck[] = [
    ...Array.from({ length: 135 }, (_, i) =>
      check(`https://visitmurphys.com/event/e-${i}/`, "unconfirmed", null, i)
    ),
    check("https://bricestation.com/products/jesse-ray-smith", "unconfirmed", 503),
    check("https://scenic4.org/events/hermitfest-west/", "unconfirmed", null),
    check("https://ironstoneamphitheatre.net/wired/cevent/tribute-fest/", "unconfirmed", null),
    check("https://www.redcrossblood.org/give.html/drive-results?zipSponsor=95247", "unconfirmed", null),
    ...Array.from({ length: 58 }, (_, i) =>
      check(`https://ok-${i % 7}.example/e-${i}`, "ok", 200, i)
    ),
  ];
  const plan = planLinkNulls(checks);
  assert.deepEqual(plan.toNull, []);
  assert.deepEqual(plan.sparedHosts, []);
});

test("one dead page on a healthy host is nulled", () => {
  const checks = [
    check("https://venue.example/a", "dead", 404, 1),
    ...Array.from({ length: 9 }, (_, i) => check(`https://venue.example/ok-${i}`, "ok", 200, i + 2)),
  ];
  const plan = planLinkNulls(checks);
  assert.deepEqual(plan.toNull.map((c) => c.id), ["https://venue.example/a#1"]);
  assert.deepEqual(plan.sparedHosts, []);
});

test("a host answering not-found for half or more of its links is spared whole", () => {
  // A bot wall that 404s, or a site move in flight: not that many dead pages.
  const checks = [
    check("https://walled.example/a", "dead", 404, 1),
    check("https://www.walled.example/b", "dead", 404, 2),
    check("https://walled.example/c", "ok", 200, 3),
    check("https://walled.example/d", "ok", 200, 4),
    check("https://other.example/x", "dead", 410, 5),
  ];
  const plan = planLinkNulls(checks);
  assert.deepEqual(plan.sparedHosts, [{ host: "walled.example", dead: 2, checked: 4 }]);
  assert.deepEqual(plan.toNull.map((c) => c.id), ["https://other.example/x#5"]);
});

test("below the minimum link count the guard does not judge a host", () => {
  const checks = [
    check("https://small.example/a", "dead", 404, 1),
    check("https://small.example/b", "dead", 404, 2),
  ];
  assert.equal(planLinkNulls(checks).toNull.length, 2);
});

test("just under half dead is still a per-page call", () => {
  const checks = [
    check("https://busy.example/a", "dead", 404, 1),
    check("https://busy.example/b", "ok", 200, 2),
    check("https://busy.example/c", "ok", 200, 3),
  ];
  assert.equal(planLinkNulls(checks).toNull.length, 1);
});

test("unconfirmed links are summarized per host so an outage reads as one", () => {
  const lines = summarizeUnconfirmed([
    ...Array.from({ length: 3 }, (_, i) => check(`https://visitmurphys.com/e-${i}`, "unconfirmed", null, i)),
    check("https://bricestation.com/p", "unconfirmed", 503),
    check("https://bricestation.com/q", "unconfirmed", null),
    check("https://fine.example/", "ok", 200),
  ]);
  assert.deepEqual(lines, [
    "visitmurphys.com 3 (no answer 3)",
    "bricestation.com 2 (HTTP 503 1, no answer 1)",
  ]);
});

// ---------------------------------------------------------------------------
// Behavior through the real validateEventUrls, against a fake Supabase and a
// stubbed fetch. supabase-admin throws at import without the service-role
// env, so set dummy env, then patch the shared client's `from`.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

type Row = { id: string; name: string; event_url: string | null; date: string };
type Answer = number | "throw";

const todayUtc = new Date().toISOString().slice(0, 10);
const plusDays = (n: number): string => {
  const d = new Date(`${todayUtc}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function runValidation(
  rows: Row[],
  answer: (url: string, method: string) => Answer
) {
  const db = rows.map((r) => ({ ...r }));
  const updates: Array<{ id: unknown; url: unknown }> = [];
  const requested: Array<{ url: string; method: string }> = [];

  function fakeQuery() {
    const filters: Array<(r: Row) => boolean> = [];
    const eqs: Record<string, unknown> = {};
    let op: "select" | "update" = "select";
    let payload: Partial<Row> = {};
    const run = () => {
      const hits = db.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        updates.push({ id: eqs.id, url: eqs.event_url });
        for (const h of hits) Object.assign(h, payload);
        return { data: hits.map((h) => ({ id: h.id })), error: null };
      }
      return { data: hits.map((h) => ({ ...h })), error: null };
    };
    const q = {
      select: () => q,
      update: (p: Partial<Row>) => ((op = "update"), (payload = p), q),
      not: (c: keyof Row, _op: string, _v: null) => (filters.push((r) => r[c] !== null), q),
      gte: (c: keyof Row, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      eq: (c: keyof Row, v: unknown) => ((eqs[c] = v), filters.push((r) => r[c] === v), q),
      order: () => q,
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, fail),
    };
    return q;
  }

  const { supabaseAdmin } = await import("../lib/supabase-admin.js");
  (supabaseAdmin as unknown as { from: () => unknown }).from = fakeQuery;
  const { validateEventUrls } = await import("../lib/validate-urls.js");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requested.push({ url, method });
    const a = answer(url, method);
    if (a === "throw") {
      throw new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    }
    return new Response(method === "HEAD" ? null : "body", { status: a });
  }) as typeof fetch;
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    const result = await validateEventUrls();
    return { result, db, updates, requested };
  } finally {
    globalThis.fetch = realFetch;
    console.log = log;
    console.warn = warn;
  }
}

test("validateEventUrls: a host that never answers keeps every link", async () => {
  const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
    id: `vm-${i}`,
    name: "Live Music Upstairs",
    event_url: `https://visitmurphys.com/event/music-on-the-rooftop/${plusDays(i)}/`,
    date: plusDays(i),
  }));
  const { result, db, updates } = await runValidation(rows, () => "throw");
  assert.equal(updates.length, 0);
  assert.equal(result.nulled, 0);
  assert.equal(result.unconfirmed, 12);
  assert.ok(db.every((r) => r.event_url !== null));
});

test("validateEventUrls: 5xx and bot walls keep the link", async () => {
  const rows: Row[] = [
    { id: "a", name: "A", event_url: "https://bricestation.com/products/a", date: plusDays(1) },
    { id: "b", name: "B", event_url: "https://www.redcrossblood.org/give.html", date: plusDays(1) },
  ];
  const { updates } = await runValidation(rows, (url) =>
    url.includes("bricestation") ? 503 : 403
  );
  assert.equal(updates.length, 0);
});

test("validateEventUrls: a confirmed 404 is nulled, and only that link", async () => {
  const rows: Row[] = [
    { id: "gone", name: "Gone", event_url: "https://venue.example/gone", date: plusDays(2) },
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `ok-${i}`,
      name: `Fine ${i}`,
      event_url: `https://venue.example/fine-${i}`,
      date: plusDays(2),
    })),
  ];
  const { result, db, updates, requested } = await runValidation(rows, (url) =>
    url.endsWith("/gone") ? 404 : 200
  );
  assert.deepEqual(updates, [{ id: "gone", url: "https://venue.example/gone" }]);
  assert.equal(result.nulled, 1);
  assert.equal(db.find((r) => r.id === "gone")?.event_url, null);
  // The HEAD 404 was confirmed with a GET before anything was written.
  assert.deepEqual(
    requested.filter((r) => r.url.endsWith("/gone")).map((r) => r.method),
    ["HEAD", "GET"]
  );
});

test("validateEventUrls: a HEAD 404 that a GET serves is kept", async () => {
  const rows: Row[] = [
    { id: "head-shy", name: "Shy", event_url: "https://shy.example/e", date: plusDays(3) },
  ];
  const { updates } = await runValidation(rows, (_url, method) =>
    method === "HEAD" ? 404 : 200
  );
  assert.equal(updates.length, 0);
});

test("validateEventUrls: past events are not checked at all", async () => {
  const rows: Row[] = [
    { id: "past", name: "Past", event_url: "https://gone.example/past", date: plusDays(-3) },
    { id: "soon", name: "Soon", event_url: "https://fine.example/soon", date: plusDays(3) },
  ];
  const { updates, requested } = await runValidation(rows, (url) =>
    url.includes("gone") ? 404 : 200
  );
  assert.equal(updates.length, 0);
  assert.ok(!requested.some((r) => r.url.includes("/past")), "a past row was fetched");
});
