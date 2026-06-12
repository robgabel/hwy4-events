/**
 * Normalize a user-entered website/URL into a clickable absolute URL.
 *
 * Submitters routinely type a bare domain ("mywinery.com", "www.mywinery.com").
 * That's a perfectly clear answer to "what's your website?", but it is not a
 * valid href, and the browser's native <input type="url"> rejects it — which is
 * exactly the trap a neighbor hit when the submit form "kept asking for a URL"
 * even though she'd entered her site. So accept what people actually type: trim
 * it, and if it has no scheme, assume https://. Returns "" for blank input.
 *
 * Shared by the client form (soften the field) and the server route (store a
 * clickable value) so the two can't disagree about what a bare domain means.
 */
export function normalizeUrl(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  // Already has a scheme (http://, https://, …) — leave it untouched.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
  // Bare domain or path: assume https and drop any leading slashes.
  return `https://${v.replace(/^\/+/, "")}`;
}
