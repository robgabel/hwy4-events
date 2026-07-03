/**
 * The single serializer for JSON-LD script bodies. JSON.stringify escapes
 * quotes but NOT "<", so a scraped event field containing
 * "</script><script>…" would close the ld+json block and execute — stored
 * XSS through structured data (found in the Eugene fork's 2026-07-02
 * security review; see docs/research/2026-07-02-peter-security-handoff.md).
 * < is valid JSON, so search engines parse the output unchanged.
 *
 * Every `<script type="application/ld+json">` sink must use this instead of
 * raw JSON.stringify. Locked by scripts/test/json-ld.test.ts.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
