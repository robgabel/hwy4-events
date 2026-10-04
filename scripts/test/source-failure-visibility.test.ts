// A scraper that reads nothing must say so where people look.
//
// 2026-09-28: GoCalaveras's events page gave no nonce (it had been
// rate-limiting us the day before). The scraper logged one line and
// returned, so the run recorded no error for it, and the health table printed
// "gocalaveras  OK" because other sources' merges keep bumping
// last_scraped_at on GoCalaveras rows. Now the failure throws with the HTTP
// status (scrape.ts records it in scrape_runs) and the health table marks the
// source as failed this run.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
// gocalaveras.ts builds its Anthropic client at import; nothing here calls it.
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

async function scrapeWithPage(status: number, html: string) {
  const { scrapeGoCalaveras } = await import("../scrapers/gocalaveras.js");
  const realFetch = globalThis.fetch;
  const { log } = console;
  globalThis.fetch = (async () => new Response(html, { status })) as typeof fetch;
  console.log = () => {};
  try {
    return await scrapeGoCalaveras();
  } finally {
    globalThis.fetch = realFetch;
    console.log = log;
  }
}

test("a rate-limited events page fails the GoCalaveras run, with the status", async () => {
  await assert.rejects(
    scrapeWithPage(429, "<html><body>Too Many Requests</body></html>"),
    /no nonce \(HTTP 429, rate-limited\)/
  );
});

test("a 200 page with no nonce fails loudly as a markup change", async () => {
  await assert.rejects(
    scrapeWithPage(200, "<html><body>A redesigned page</body></html>"),
    /no nonce \(HTTP 200, the page loaded, so the markup may have changed\)/
  );
});

test("a page with a nonce but no calendar shortcode fails loudly too", async () => {
  await assert.rejects(
    scrapeWithPage(200, `<script>var x = {"postnonce":"abc123"};</script>`),
    /no data-sc shortcode \(HTTP 200/
  );
});

// ---------------------------------------------------------------------------
// The health table, against a fake Supabase where gocalaveras looks fresh
// (scraped today, 5 future events): exactly the shape that printed "OK".
// ---------------------------------------------------------------------------

function fakeFrom() {
  let cols = "";
  let head = false;
  let single = false;
  const run = () => {
    if (head) return { data: null, count: 5, error: null };
    if (cols === "org_slug") return { data: [{ org_slug: "gocalaveras" }], error: null };
    if (cols === "last_scraped_at") {
      const row = { last_scraped_at: new Date().toISOString() };
      return { data: single ? row : [row], error: null };
    }
    return { data: [], error: null };
  };
  const q = {
    select: (c: string, opts?: { head?: boolean }) => ((cols = c), (head = !!opts?.head), q),
    not: () => q,
    eq: () => q,
    gte: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => ((single = true), q),
    then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(ok, fail),
  };
  return q;
}

async function healthOutput(sourceErrors?: Map<string, string>): Promise<string> {
  const { supabaseAdmin } = await import("../lib/supabase-admin.js");
  (supabaseAdmin as unknown as { from: () => unknown }).from = fakeFrom;
  const { runHealthCheck } = await import("../lib/health.js");
  const lines: string[] = [];
  const { log, warn } = console;
  console.log = console.warn = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    await runHealthCheck(["gocalaveras"], sourceErrors);
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return lines.join("\n");
}

test("the health table marks a source that threw this run, even when its rows look fresh", async () => {
  const out = await healthOutput(
    new Map([["gocalaveras", "GoCalaveras events page gave no nonce (HTTP 429, rate-limited)."]])
  );
  const row = out.split("\n").find((l) => l.startsWith("gocalaveras"));
  assert.ok(row, out);
  assert.match(row, /ERROR this run/);
  assert.match(out, /gocalaveras: Scraper failed this run: GoCalaveras events page gave no nonce/);
});

test("without an error the same fresh source still reads OK", async () => {
  const out = await healthOutput();
  const row = out.split("\n").find((l) => l.startsWith("gocalaveras"));
  assert.ok(row, out);
  assert.match(row, /OK$/);
});

test("a failed source whose key names no org row still gets a warning", async () => {
  const out = await healthOutput(new Map([["hwy4-fb-discover", "Apify 400"]]));
  assert.match(out, /hwy4-fb-discover: Scraper failed this run: Apify 400/);
});
