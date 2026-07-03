// Regression lock for newsletter email-HTML escaping (lib/newsletter-render.ts).
//
// The body is untrusted: LLM output, admin textarea edits, and scraped event
// titles it name-drops. Before the 2026-07-02 fix (P8), text was interpolated
// into <p> with only [label](url) conversion, so a raw `<img onerror>` in a
// title passed into the outgoing email and link labels/hrefs were unescaped.
// These cases pin: every text node + label is escaped, only http(s) links
// render as <a>, and the scannable-spine bolding still works.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderParagraphs, renderInline, escapeHtmlText } from "../../lib/newsletter-render";

// A resolver mirroring newsletter.ts's rule: http(s) → itself, else null.
const httpOnly = (u: string): string | null => {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
};

test("raw HTML in body text is escaped, not emitted", () => {
  const html = renderParagraphs(
    "Concert <img src=x onerror=alert(1)> tonight",
    "x",
    false,
    httpOnly
  );
  assert.ok(!html.includes("<img"), "raw <img must not appear");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("a </script> in an event title cannot break out", () => {
  const html = renderInline("Band </script><script>alert(1)</script>", false, httpOnly);
  assert.ok(!html.includes("<script"), "raw <script must not appear");
  assert.ok(!html.includes("</script>"), "raw </script> must not appear");
});

test("javascript: link renders as inert escaped text, not an <a>", () => {
  // Paren-free payload so the markdown regex captures the whole scheme.
  const html = renderInline("[click me](javascript:alert1)", false, httpOnly);
  assert.ok(!html.includes("<a "), "no anchor for a non-http scheme");
  assert.ok(!html.toLowerCase().includes("href"), "no href at all");
  assert.equal(html, "click me");
});

test("data: link also renders inert (no href)", () => {
  const html = renderInline("[x](data:text/html;base64,PHNjcmlwdD4)", false, httpOnly);
  assert.ok(!html.includes("<a "));
  assert.ok(!html.toLowerCase().includes("href"));
});

test("http(s) link renders as an <a> with an escaped label", () => {
  const html = renderInline(
    "[Rock & Roll <b>Show</b>](https://hwy4events.com/events/x)",
    false,
    httpOnly
  );
  assert.ok(html.includes('<a href="https://hwy4events.com/events/x"'));
  assert.ok(html.includes("Rock &amp; Roll &lt;b&gt;Show&lt;/b&gt;</a>"));
  assert.ok(!html.includes("<b>"), "label HTML must be escaped");
});

test("an ampersand in a link href is attribute-escaped", () => {
  const html = renderInline("[x](https://ex.com/a?b=1&c=2)", false, httpOnly);
  assert.ok(html.includes('href="https://ex.com/a?b=1&amp;c=2"'));
});

test("scannable-spine bolding still works after escaping (apostrophe survives)", () => {
  const html = renderInline("Rob's Pick: the big one", true, httpOnly);
  assert.ok(html.includes("<strong>Rob's Pick:</strong>"));
});

test("dated weekday anchor is bolded; text around it is escaped", () => {
  const html = renderInline("Saturday, June 6 <x> party", true, httpOnly);
  assert.ok(html.includes("<strong>Saturday, June 6</strong>"));
  assert.ok(html.includes("&lt;x&gt;"));
});

test("escapeHtmlText escapes the three text-special chars only", () => {
  assert.equal(escapeHtmlText(`a & b < c > d "e" 'f'`), `a &amp; b &lt; c &gt; d "e" 'f'`);
});
