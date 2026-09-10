# Record: Facebook location IDs + group vetting

> **Status (2026-09-05): DONE.** All five location IDs are filled and verified,
> and the `uh4ccc` group was confirmed public (independently, by Rob in a
> logged-out window and by an automated logged-out fetch). Current truth about
> both sources lives in CLAUDE.md and in the two scraper files. Nothing below is
> outstanding work; it is kept as the record of how the IDs were obtained, since
> the next town added will need the same method.

## How the five IDs were obtained (without a logged-in session)

The original plan was to read each ID off `facebook.com/events/explore/` in a
logged-in browser. That turned out to be unnecessary. Facebook's **public place
pages** render logged out and are keyed by the same numeric ID:

```
https://www.facebook.com/places/x/<id>/
```

The page title and its venue/event list are rendered **from the ID alone** — a
deliberately mismatched name slug (Arnold's ID under a `Murphys` path) still
titled the page "Things to do in Arnold, California". So that URL is a
verification oracle for a candidate ID, with no session and no cookies.

Candidate IDs came from web search (`facebook.com/places "Things to do in
<Town>, California"`), then each was confirmed by corridor landmarks on its own
place page:

| Town | ID | Confirmed by |
|---|---|---|
| Arnold | `105475469485316` | (was already live) |
| Murphys | `109648499061365` | Firewood, Grounds, Murphys Pride on Main St |
| Angels Camp | `112419192105459` | Crusco's, Camps at Greenhorn Creek |
| Bear Valley | `104088062962459` | Creekside Bistro, Sourgrass, "1 Bear Valley Rd" |
| Copperopolis | `106218426077047` | Louie's Pizza, Music In The Square, 100 Town Square |
| Avery | `107705869252736` | Heart & Soul country kitchen, 4529 Hwy 4 |

**Bear Valley was the one worth care.** Web search does not surface it under the
obvious query, and there are at least two other Bear Valleys in California
(Mariposa County, and Bear Valley Springs in Kern). The ID above was accepted
only after its place page showed Alpine-County-on-Hwy-4 landmarks.

## Live verification (read-only, no writes)

Each config was then run through `fetchFacebookDiscoverEvents` directly —
bypassing `upsertEvents`, so nothing was written — to prove the **slug + ID pair
actually resolves to that town** rather than to Facebook's global events page:

| Town | Events returned | Towns present |
|---|---|---|
| Arnold | 3 | `{Arnold: 3}` |
| Murphys | 4 | `{Murphys: 4}` |
| Angels Camp | 3 | `{Angels Camp: 3}` |
| Bear Valley | 2 | `{Bear Valley: 2}` |
| Copperopolis | 9 | `{Copperopolis: 9}` |
| Avery | 1 raw, 0 mapped | — |

No cross-town contamination anywhere, which is what the global-events-page
failure mode would have looked like. **Avery is the weak one**: it returned a
single raw item that was dropped for a missing name/date, so its explore URL is
confirmed only by the place-page oracle, not by a mapped event. It is a hamlet,
so a thin month is expected; if Avery is still returning nothing in a few weeks,
re-check its slug before assuming there is simply nothing on.

## Group ingest

`uh4ccc` ("The Original Upper Hwy 4 Corridor Calaveras County Group") is
**Public**, 10.1K members — posts are readable with no account.

> **Still do not supply session cookies to read a private group.** The Apify
> group actors accept a `cookieString` from a logged-in member, which puts a
> personal Facebook session in a GitHub Actions secret with an account ban
> attached. Long-tail listings are not worth a Facebook account. Public only.

The pinned actor (`apify~facebook-groups-scraper`) and its field names were
originally written from documentation, because `apify.com` was egress-blocked
from the container that wrote them. **A live dry run confirmed the shape**: of
60 returned items, 59 mapped cleanly. `url` carries the permalink,
`facebookUrl` the group, plus `time` and `user`. No mapper change was needed.

That run also gives the first real read on queue volume: 59 posts inside the
14-day floor → 13 looked like event announcements → 12 extractions (the per-run
cap, 1 deferred) → **6 events**, all plausible: Community Yard Sale, Labor Day
Concert, SIR Branch 152 BBQ Picnic, Labor Day Weekend Arts & Crafts Festival,
and two named live-music sets.

## What to watch in week one

The number that matters is **queued submissions ÷ ones actually published**. If
the queue fills with chatter, tighten `EVENT_SIGNALS` / `QUESTION_ONLY` in
`scripts/lib/facebook-groups.ts` rather than living with it. A review queue that
stops being opened is how this becomes the fourth dead Facebook source.

**To back either out:** blank the `locationId`s, or empty `GROUP_CONFIGS`. Both
go dormant with no other change and no data to clean up.

## Adding another town later

1. Web-search `facebook.com/places "Things to do in <Town>, California"`.
2. Confirm the ID at `https://www.facebook.com/places/x/<id>/` — the title must
   name the town, and the venues must be ones you recognize.
3. Add the entry with `exploreSlug: "<town>-ca"` and run the read-only fetch
   before the first real scrape. A wrong slug returns another location's events,
   which the town histogram above makes obvious.
