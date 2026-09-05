# Handoff: Facebook location IDs + group vetting (needs a logged-in browser)

> **Status (2026-09-05):** Everything except this document is shipped. Five FB
> Discover towns are wired and waiting on one string each; the group ingest is
> live with one group configured. Both steps below need a logged-in Facebook
> session, which a cloud agent has no path to. `facebook.com` is refused at the
> egress proxy (`connect_rejected … 403 to CONNECT`) and Firecrawl declines the
> domain outright, so this is genuinely a human-with-a-browser job, not a
> tooling gap to route around.

Total time: about 15 minutes. Nothing here touches production data until you
commit; both steps are reversible by reverting one line.

---

## Step 1: five location IDs (about 10 minutes)

Facebook's events explore page is keyed by a numeric **place ID** that is only
rendered for a logged-in session. We have Arnold. We need five more.

**For each town below:**

1. Open <https://www.facebook.com/events/> while logged in.
2. In the location filter, type the town name and pick it from the dropdown.
3. The URL becomes `https://www.facebook.com/events/explore/<slug>/<numeric-id>`.
4. Copy the **numeric tail** and the **slug**.

Then paste each ID into `scripts/scrapers/hwy4-fb-discover.ts`, between the
quotes that are already there:

| Town | Entry to fill | Expected slug |
|---|---|---|
| Murphys | `fb-discover-murphys` | `murphys-ca` |
| Angels Camp | `fb-discover-angels-camp` | `angels-camp-ca` |
| Bear Valley | `fb-discover-bear-valley` | `bear-valley-ca` |
| Copperopolis | `fb-discover-copperopolis` | `copperopolis-ca` |
| Avery | `fb-discover-avery` | `avery-ca` |

**If the real slug differs from the expected one, use the real one** and fix the
`exploreSlug` field too. The slug is part of the URL that actually gets scraped;
a wrong one silently returns the wrong location's events.

That is the whole edit. The entries already exist with `locationId: ""`, their
`hwy4_orgs` rows are already inserted, and `isConfiguredTown` skips any entry
whose ID is not all digits, so a half-finished paste is inert rather than
dangerous. (An empty ID would otherwise build an explore URL that resolves to
Facebook's **global** events page and pour non-corridor events into the corridor
filter on every run. That guard is test-locked.)

**Verify before committing:**

```sh
cd scripts && npm run scrape -- --source hwy4-fb-discover
```

Read the per-town extraction lines. You want corridor towns and plausible dates.
If a town returns events from somewhere else entirely, its slug or ID is wrong;
blank the `locationId` again and it goes dormant.

---

## Step 2: vet the Facebook groups (about 5 minutes)

The group ingest (`scripts/scrapers/hwy4-fb-groups.ts`) is live with one group
configured, `uh4ccc`. Two things to confirm.

**a) Is it public?** Open <https://www.facebook.com/groups/uh4ccc> in a
**logged-out** window (private/incognito). If you can read posts, it is public
and the actor works with no credentials. If it demands a login, remove it from
`GROUP_CONFIGS`.

> **Do not supply session cookies to make a private group work.** The Apify
> group actors accept a `cookieString` from a logged-in member, which means your
> personal Facebook session sitting in a GitHub Actions secret, with an
> account-ban attached if Meta notices. Long-tail listings are not worth your
> Facebook account. Public groups only.

**b) Add any other public corridor groups** to `GROUP_CONFIGS` in that file:

```ts
{ slug: "arnold-ca", url: "https://www.facebook.com/groups/<slug>", label: "Arnold Community" },
```

No `hwy4_orgs` row is needed. These land as `event_submissions`, not events, so
there is no foreign key to satisfy.

**Then dry-run it:**

```sh
cd scripts && npm run scrape -- --source hwy4-fb-groups --dry-run
```

`--dry-run` writes no submissions and no cursor, and **prints the first raw
Apify item**. Check that against `mapGroupPost` in
`scripts/lib/facebook-groups.ts`: we read post text from `text` / `postText` /
`message` / `content` / `caption` and the permalink from `url` / `postUrl` /
`facebookUrl` / `permalink` / `link`. The Apify store has several competing
group actors with different field names and no stable schema, and `apify.com` is
also egress-blocked from the cloud container, so the pinned actor
(`apify~facebook-groups-scraper`) and its field shape are the one part of this
that was written from documentation rather than from a live response.

If the shape differs, add the actual key names to those arrays. An item we
cannot map is skipped, never guessed at, so a mismatch degrades to "found
nothing" rather than to fiction.

---

## What happens after you commit

The daily scrape Action picks both up automatically. Group posts flow:

```
public group post
  → strict candidate filter (needs a day anchor AND an event signal)
  → one Sonnet call per post
  → PENDING event_submissions row, pinned to the post permalink
  → /api/agent/triage-submissions (18:30 UTC) attaches a verdict
  → you click Publish / Merge / Dismiss at /admin/submissions
```

**No group post ever writes to `hwy4_events`.** That is the design, not a
limitation: three of the four rows the June 2026 one-off run wrote directly into
events carried neither `source_event_id` nor `event_url`, which is the
unverifiable / uncorrectable / unretractable shape of the 36 Murphys Irish Pub
phantoms. The human click is the pin.

Cost control is two-layered: the candidate filter decides what is worth a model
call, and a per-group high-water cursor in `site_config`
(`fb_group_cursor_<slug>`) stops us re-reading the same post daily. There is a
hard ceiling of 12 extractions per group per run.

**Watch the first week.** The number to care about is the ratio of queued
submissions to ones you actually publish. If the queue fills with chatter you
dismiss, tighten `EVENT_SIGNALS` / `QUESTION_ONLY` in
`scripts/lib/facebook-groups.ts` rather than living with it. A review queue that
stops being opened is how this becomes the fourth dead Facebook source.

**To back either out:** blank the `locationId`s, or empty `GROUP_CONFIGS`. Both
go dormant with no other change and no data to clean up.
