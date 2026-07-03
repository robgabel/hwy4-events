> Provenance: emailed by Peter Hollens 2026-07-02 ("Heads up from the Eugene fork security review"), attachment rob-upstream-security-handoff-2026-07-02.md. Saved here 2026-07-03. Verified upstream so far: JSON-LD XSS sink real at lib/schema.tsx:21 + app/events/[slug]/page.tsx:185; CRON_SECRET fail-open pattern real across ~25 api routes.

# Upstream Security And Correctness Handoff For Hwy4 Events

Date: 2026-07-02

Prepared from review of the Eugene fork, `This Week in Eugene`.

This packet is meant for Rob / maintainers of `robgabel/hwy4-events`. It is not an assertion that every issue exists upstream. The Eugene fork has diverged. Treat this as a targeted checklist for shared architectural patterns that may have been inherited from the original engine.

## How To Use This

Recommended first pass in the upstream repo:

```bash
rg -n "dangerouslySetInnerHTML|JSON.stringify\\(|type=\\\"application/ld\\+json\\\"|ld\\+json" app components lib
rg -n "cronSecret &&|CRON_SECRET|Authorization|Bearer" app/api lib middleware.ts
rg -n "normalizeUrl|event_url|source_url|href=\\{|javascript:" app components lib scripts
rg -n "isSameEvent|sameVenue|textSimilarity|artist.*overlap|dedupe|reconcile" lib scripts
rg -n "pricePayload|cost_tier|price_locked|extract-prices|\\bfree\\b" app lib scripts
rg -n "new Date\\(\\)|toISOString\\(\\)\\.split\\(\"T\"\\)|getDay\\(" app components lib scripts
rg -n "markdown|newsletter|buildEmailHtml|dangerouslySetInnerHTML" lib app components
```

Then check the top issues below.

## Executive Summary

The highest-risk issue found in the Eugene fork is stored XSS through JSON-LD schema output. It is likely to exist in any sibling codebase that serializes scraped event data into `<script type="application/ld+json">` using raw `JSON.stringify(...)` inside `dangerouslySetInnerHTML`.

The next tier is mostly correctness and operational safety:

- Auth gates that fail open when `CRON_SECRET` is unset.
- Dedupe logic that can hide or later delete separate real events.
- Scraper update paths that do not propagate rescheduled dates.
- Runtime timezone math that labels Pacific events incorrectly.
- Public endpoints with no rate limit or honeypot.
- Supabase reads that ignore `{ error }` and treat failures as empty data.
- Missing pagination around the 1,000-row PostgREST cap.
- Newsletter/email HTML that is not escaped.

## Priority 0: Stored XSS Through JSON-LD

### Pattern To Look For

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
/>
```

or:

```tsx
dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
```

### Why It Matters

`JSON.stringify` escapes quotes, but it does not escape `<`. If an event title, venue, artist, address, or other scraped string contains:

```html
</script><script>alert(1)</script>
```

then the browser can close the JSON-LD script tag and execute attacker-controlled JavaScript.

This is more serious for event aggregators than ordinary CMS sites because event fields are often scraped automatically from RSS, iCal, Localist, WordPress, or third-party event feeds.

### Minimal Safe Fix

Use a single serializer helper for all JSON-LD:

```ts
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
```

Then:

```tsx
dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
```

Escaping `<` this way is valid JSON. Search engines and structured-data parsers still parse it correctly.

### Defense In Depth

- Strip tag-like text from event names, venues, and artists at ingest.
- Add a conservative CSP if compatible with the app.
- Add a regression test proving `</script>` becomes `\u003c/script>`.

## Priority 1: URL Scheme Allowlisting

### Pattern To Look For

Any helper that accepts any scheme:

```ts
if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
```

Any rendered event/source link that trusts `event_url` or `source_url`:

```tsx
<a href={event.event_url}>Visit Event Page</a>
```

### Risk

`javascript://evil.com/%0aalert(1)` can look parseable to `new URL(...)` and may survive host checks, then render as a clickable link. It is click-required, so it is lower severity than the JSON-LD script break-out, but it is the same trust-boundary class.

### Fix

Use a shared HTTP-only helper:

```ts
export function normalizeHttpUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  return url.toString();
}
```

Apply this at:

- Public submissions.
- Admin publish/merge actions.
- Scraper ingest before storing event links.
- Link resolver before rendering.
- Markdown link renderers.

## Priority 2: Cron/Auth Fail-Closed

### Pattern To Look For

```ts
const cronSecret = process.env.CRON_SECRET;
if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  return unauthorized;
}
```

### Risk

If `CRON_SECRET` is unset in a preview, staging, or production environment, the route becomes public. This is especially risky for routes that:

- Run paid model calls.
- Update drafts.
- Verify or mutate events.
- Reconcile or delete duplicates.
- Send newsletter email.

### Fix

Fail closed:

```ts
export function requireCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
```

Use that helper everywhere. If local dev needs a bypass, make it explicit and environment-gated.

## Priority 3: Dedupe Venue Veto

### Pattern To Look For

In event identity / dedupe code:

```ts
const sameVenue = ...

if (sameTown && sameTime && titleSimilarity >= 0.85) return true;
if (sameTown && sameTime && artistsOverlap) return true;
```

where `sameVenue` is computed but not used to prevent merges.

### Risk

Two different events named "Trivia Night", "Open Mic", "Karaoke", "Board Game Night", etc. can happen at different venues on the same date and time. If dedupe merges them:

- One disappears from public lists immediately.
- A future reconcile/delete job can permanently delete the loser.

### Safer Fix Shape

Do not simply require same venue for every merge, because some legitimate umbrella merges rely on a source-level event and a venue-level event matching each other. Instead:

- If both venues are known and non-generic and disagree, do not merge on title/artist alone.
- Allow merge if there is a stronger signal, such as same source event id, same canonical URL, or a known umbrella/series relationship.
- Add tests for both:
  - Separate "Trivia Night" at two different venues should not merge.
  - Legitimate umbrella/series duplicate at the same venue should still merge.

## Priority 4: Rescheduled Dates In Dedup Updates

### Pattern To Look For

Scraper/dedup update payloads that write:

- name
- venue
- start_time
- end_time
- price
- event_url
- address
- town
- category
- image_url
- dedup_key

but do not compare or update `date`.

### Risk

If a venue reschedules an event but keeps the same source id or URL, the app can keep showing the old date. Worse, if the dedup key gets recomputed with the new date while the stored `date` remains old, identity data becomes internally inconsistent.

### Fix

- Include `date` in the existing-row select.
- Include `existing.date !== incoming.date` in changed detection.
- Include `date: incoming.date` in matched-row update payloads.
- Be careful with sources where one source id represents a recurring series rather than a single occurrence. Those may need source ids expanded with date.

## Priority 5: Pacific/Local Date Handling

### Pattern To Look For

```ts
new Date()
new Date().getDay()
new Date().toISOString().split("T")[0]
```

inside user-facing labels like:

- Today
- Tomorrow
- This Weekend
- Next Weekend
- Daily briefing windows
- Newsletter date windows

### Risk

On Vercel/server runtimes, `new Date()` is UTC-oriented. A Pacific-time events site can label tomorrow as today every evening, especially after 5pm PT. Client hydration can then disagree with server-rendered HTML.

### Fix

Use one helper that returns the Pacific civil date and weekday:

```ts
export function pacificDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  // Build YYYY-MM-DD and weekday from parts.
}
```

Compare event date strings to Pacific date strings, not to UTC Date objects.

## Priority 6: Supabase Read Errors And Pagination

### Pattern To Look For

```ts
const { data } = await supabase.from("...").select("...");
const rows = data ?? [];
```

or unpaginated reads on tables near or above 1,000 rows:

```ts
await supabase.from("hwy4_events").select("*").gte("date", today)
```

### Risk

- A failed read becomes an empty array.
- Empty arrays drive wrong decisions: publish duplicate, no candidates, no gaps, no events, etc.
- PostgREST silently caps results at 1,000 rows unless paginated.
- Non-deterministic ordering can skip or duplicate rows across pages.

### Fix

Use a shared helper:

```ts
async function selectAllOrThrow<T>(
  queryFactory: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
```

Always add a deterministic final tiebreaker such as `.order("id")`.

## Priority 7: Price And Free Signals

### Patterns To Look For

Naive free sniff:

```ts
/\bfree\b/i.test(text)
```

Price update that overwrites with null:

```ts
price: incoming.price
```

### Risks

- "Free parking", "gluten-free", "smoke-free", "free gift" become "Free admission".
- Extracted prices can be wiped by the next scraper run if the source does not repeat the price.

### Fix

- Use a shared `hasFreeSignal` helper that requires admission intent:
  - free admission
  - free entry
  - free event
  - free to attend
  - no cost
  - no cover
- Exclude:
  - free parking
  - gluten-free
  - smoke-free
  - fragrance-free
  - free gift
- Never overwrite an existing non-null price with null unless a human explicitly clears it.
- Respect `price_locked` if present.

## Priority 8: Newsletter HTML Escaping

### Pattern To Look For

Markdown-ish text converted to HTML strings:

```ts
return `<p>${markdownLinksToHtml(content)}</p>`;
```

where non-link text, link labels, URLs, event names, or admin notes are not escaped.

### Risk

Scraped event titles or edited newsletter text can inject HTML into outgoing email. This may not execute JavaScript in most email clients, but it can embed images, tracking, broken layout, misleading links, or phishing-like markup.

### Fix

- Escape all text first.
- Parse and reinsert only allowed `<a>` tags.
- Allow only `http:` and `https:` hrefs.
- Escape link labels and attributes.
- Test an event title like `<img src=x onerror=alert(1)>`.

## Priority 9: Public Endpoint Abuse Hardening

Check public endpoints that:

- Send email.
- Upload files.
- Trigger model calls.
- Write analytics rows.
- Generate CPU-heavy images.

Recommended shared protections:

- Honeypot field for forms.
- Per-IP and per-email rate limits.
- Body size caps.
- File type validation.
- Cheap bot checks.
- Backoff/cooldown.
- Idempotency where possible.

Specific patterns seen in the Eugene fork:

- Feedback email endpoint without rate limit.
- Newsletter subscribe first-time address without IP throttle.
- Event submission triggers model/web-search triage.
- Static map endpoint accepts arbitrary floats.
- Tracking endpoints allow row floods.

## Priority 10: Event Time And Overnight Events

### Patterns To Look For

- Fake "absolute minutes" using fixed month lengths.
- Past-midnight events with end time earlier than start time.
- Calendar links that use the same date for start and end.
- JSON-LD `endDate` before `startDate`.

### Fix

- Use real timezone-aware date arithmetic.
- If `end_time <= start_time`, treat end date as next day.
- Add `ctz=America/Los_Angeles` to Google Calendar URLs.
- Keep placeholder end times like `23:59` out of live-status windows.

## Lower-Priority But Worth Checking

- Poster/OG font fetch promise memoization: clear memo on rejection and check `response.ok`.
- Supplied poster redirect: validate `image_url` before `NextResponse.redirect`.
- iCal `LOCATION` parsing: do not store a venue name as an address unless it looks like a street address.
- URL validation scripts: do not null URLs on timeout/405; filter future rows and paginate.
- Merge/reconcile audit logs: add uniqueness if retries can duplicate merge records.

## Suggested Upstream Test Cases

### JSON-LD XSS

```ts
const event = {
  name: 'Concert </script><script>globalThis.pwned=1</script>',
};
expect(renderedJsonLd).not.toContain("</script><script>");
expect(renderedJsonLd).toContain("\\u003c/script>");
```

### URL Scheme

```ts
expect(normalizeHttpUrl("javascript://evil.com/%0aalert(1)")).toBe("");
expect(normalizeHttpUrl("example.com/event")).toBe("https://example.com/event");
```

### Dedupe Venue Veto

```ts
expect(
  isSameEvent(
    { name: "Trivia Night", date, town: "Murphys", venue_name: "Venue A", start_time: "19:00" },
    { name: "Trivia Night", date, town: "Murphys", venue_name: "Venue B", start_time: "19:00" }
  )
).toBe(false);
```

### Rescheduled Date

```ts
// Existing source_event_id same, incoming date changed.
// Update should write the new date.
```

### Pacific Labels

```ts
// Fake now = 2026-07-03T02:00:00Z, which is Jul 2 at 7pm PT.
// "Today" should be 2026-07-02, not 2026-07-03.
```

### Free Signal

```ts
expect(hasFreeSignal("Concert with free parking, tickets $30")).toBe(false);
expect(hasFreeSignal("Free admission for all ages")).toBe(true);
expect(hasFreeSignal("Gluten-free baking class $45")).toBe(false);
```

## Suggested Fix Order

1. JSON-LD escaping and HTTP-only URL allowlisting.
2. Fail-closed cron auth.
3. Dedupe venue veto.
4. Rescheduled date propagation.
5. Pacific date helper.
6. Supabase read helper for error handling, pagination, and deterministic order.
7. Price/free signal fixes.
8. Newsletter HTML escaping.
9. Public endpoint rate limits/honeypots.
10. Remaining poster/time/iCal/validator hygiene.

## Tone / Framing

These are normal findings for an app that:

- Scrapes unattended public data.
- Renders SEO schema.
- Sends newsletters.
- Self-heals duplicate records.
- Exposes public submission and feedback endpoints.

The engine is still a strong base. The main lesson is that the more automated the ingestion and publishing pipeline becomes, the more every output sink needs to assume scraped text is hostile until escaped.
