/**
 * URL helpers with an http(s)-only allowlist.
 *
 * Event/venue/org URLs are attacker-adjacent: they arrive from public
 * submissions, unattended scrapers, and Google Places. A value like
 * `javascript://evil.com/%0aalert(1)` parses cleanly with `new URL(...)` and
 * survives a hostname check, so if it reaches an `href` it becomes a
 * click-to-execute XSS (2026-07-02 upstream security review, P1;
 * docs/research/2026-07-02-peter-security-handoff.md). Every place a stored URL
 * becomes a link must pass through this allowlist. Locked by
 * scripts/test/url.test.ts.
 */

/** True only for a parseable absolute http: or https: URL. Everything else —
 *  javascript:, data:, mailto:, vbscript:, a bare word, unparseable junk —
 *  is false. Use to gate any external href built from stored/scraped data. */
export function isHttpUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "http:" || u.protocol === "https:";
}

/**
 * Normalize a user-entered website/URL into a clickable absolute URL, or "".
 *
 * Submitters routinely type a bare domain ("mywinery.com", "www.mywinery.com").
 * That's a perfectly clear answer to "what's your website?", but it is not a
 * valid href, and the browser's native <input type="url"> rejects it — which is
 * exactly the trap a neighbor hit when the submit form "kept asking for a URL"
 * even though she'd entered her site. So accept what people actually type: trim
 * it, and if it has no scheme, assume https://.
 *
 * Returns "" for blank input AND for anything that isn't http/https once a
 * scheme is resolved — so `javascript:`, `data:`, `vbscript:`, and unparseable
 * junk can never be stored and later rendered as a live link.
 *
 * Shared by the client form (soften the field) and the server route (store a
 * clickable value) so the two can't disagree about what a bare domain means.
 */
export function normalizeUrl(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  // Already has a scheme (http://, https://, javascript://, …) — keep as typed;
  // otherwise assume https and drop any leading slashes on a bare domain/path.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v)
    ? v
    : `https://${v.replace(/^\/+/, "")}`;
  // Allowlist: only http/https may be stored. Return the pre-parse string (not
  // URL.toString()) so a valid bare domain stays byte-for-byte what the user
  // expects ("https://mywinery.com", no forced trailing slash).
  return isHttpUrl(withScheme) ? withScheme : "";
}
