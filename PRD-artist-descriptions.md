# PRD — Artist / Band Descriptions

> **Status (2026-07-20):** **Phase 1 built** (data + drafter + review, no public render). Shipped: migration `20260720_artists.sql` (`hwy4_artists`), `lib/agent/research-artist.ts` + `lib/agent/draft-artist-blurbs.ts` (conservative — errs on nothing, always links out), daily cron `/api/agent/draft-artist-blurbs`, the `/admin/artists` review tab (Pulse). **Manual step to activate:** apply the migration (Supabase MCP was disconnected at build time). Phases 2 (public render) + 3 (`/artists/[slug]` hubs) remain. Extends `PRD-live-music-experience.md` Phase 3 and **revises its stance** — see §3.

## 1. Thesis

We already give every registry **venue** a two-sentence local-voice blurb. Do the same for the **band**: who they are, what they sound like, where they're from. Live music is the site's #1 category (~259 upcoming), and on a live-music detail page the deepest blank isn't the venue, it's *"who is this act and would I like them?"* Filling it is the difference between a bare listing and a reason to commit to the drive.

Two extra reasons this is worth more than it looks:

- **The strongest content on the whole site.** A real slice of these acts are genuine Calaveras/Sierra locals (Grover Anderson and Brian Jirka are both *Murphys*; the Poison Oakies are Calaveras). Nobody else on the internet has written a neighbor-voice blurb about them, so an accurate one is a pure AEO win: "who is Grover Anderson" → our page.
- **A cooperation flywheel.** Linking out to a band's own site/Spotify helps the band, which earns their cooperation on schedules and posters (the same loop the poster PRD chases).

## 2. Feasibility — validated 2026-07-20

Before proposing this, we researched **10 real acts pulled from the seed scripts** (Lube Room, Camp Connell Beer Garden, Bear Valley) to see what's actually knowable:

| Act | Result | Grounding source |
|---|---|---|
| Grover Anderson & the Lampoliers | ✅ Rich | Own site + Calaveras Enterprise profile. **Murphys local**, story-driven folk-rock. |
| Poison Oakies | ✅ Rich | Own site. Hardcore-country cover band, formed 2015, Calaveras. |
| Jimbo Scott & Yesterday's Biscuits | ✅ Rich | Own site. Genre-spanning Americana. |
| Brian Jirka Project | ✅ Rich | Own site. **Murphys local.** Original ska/rock/pop. |
| Snarky Cats | ✅ Rich | Own site. "Anti-cover cover band"; lists Arnold & Murphys gigs. |
| Hired Gunn | ✅ Good | Rock cover band (Rush/Styx/Zeppelin), Tuolumne/Murphys. |
| Sally and the Fields | 🟡 Medium | Livermore rock "supergroup"; findable but identity not certain. |
| Surf Creeps | 🟡 Ambiguous | Santa Cruz surf/rockabilly fits, but a San Diego "Creepy Creeps" muddies it. |
| The Delta Chicks | ❌ Blank | No clean match. |
| Jill Warren | ❌ Blank | Too common a name, no local signal. |

**Distribution: ~70% strongly findable, ~10% partial, ~20% blank.** Better than feared in two ways: most findable acts have **their own websites** (low-hallucination grounding, not model memory), and the blanks are honestly handleable (Tier C). The hazard this surfaced is **not** the blanks — it's the **ambiguous** ones (§3).

## 3. The accuracy contract (and the stance change)

The live-music PRD's Phase 3 originally said of artists: *"link the artist to their own site / Spotify / Bandcamp when discoverable, never describe their sound from thin air."* The feasibility research revises that: **describing is feasible now — because groundable single sources exist for most acts — but only through the venue-blurb-style human-review gate.** The reason to describe is that a genre + one-line vibe is exactly what a browser needs; the reason to gate it is the ambiguity hazard below.

Same three tiers as venues:

- **Tier A — verified, auto:** an outbound **link** to the act's own site / Spotify / Bandcamp / Facebook when a confident match is found (reuses the `resolveEventLink` philosophy — social/aggregator hosts are fine here since it's attribution, not a durable CTA).
- **Tier B — local voice, human-reviewed, never auto-published:** the prose blurb **and** the genre tag. Drafted by an agent with its **sources attached**, staged pending, published only by a human Save at `/admin/artists`.
- **Tier C — graceful blank:** when unknown or ambiguous, render nothing (or just the safe genre chip if even one gig listing supports it). Never invent a bio.

**The one real hazard — misattribution, not blanks.** A model asked "tell me about Surf Creeps" will confidently pick *a* band and may pick the wrong one. This is why the draft must carry its source URLs and a confidence score, and why a human clicks publish. A wrong-band bio is worse than no bio. Concretely, the drafter must:
- return **`confidence: low` + no prose** when it can't tie the name to a single act with a corroborating local signal (played this venue/region), and
- surface every source URL in the review card so a human rejects a wrong guess in one glance.

## 4. Design shape (two honest outputs, like the weather chip)

1. **Genre chip — always, low risk.** Even most "blank" acts support a one-word genre from a single gig listing ("Country cover band"). High scan value, hard to get wrong. Renders next to the existing `artists` chip on the card and detail page.
2. **Prose blurb — only on a confident single-source match.** Two sentences, neighbor voice, `withVoice()`-linted, em-dash-free, banned-phrase checked. Shown on the detail page in an `ArtistInfo` block beside `VenueInfo`.

## 5. Data model

New table `hwy4_artists`, mirroring `hwy4_venues` (RLS on, public read, service-role write):

| Column | Purpose |
|---|---|
| `artist_key` (pk) | normalized slug of the name (via `normalizeName` in `lib/event-identity.ts`, so `"Star Dogs"`/`"StarDogs"` collapse) |
| `name` | canonical display name |
| `genre` | published one-word/short genre tag (Tier B, human-approved) |
| `blurb` + `blurb_generated_at` | published local-voice prose — **only ever written by a human Save** |
| `blurb_draft` + `blurb_draft_at` + `blurb_draft_meta` | pending machine draft (confidence/sources/genre suggestion), never rendered publicly |
| `links` (jsonb) | `{ website?, spotify?, bandcamp?, facebook? }` — Tier A |
| `hometown` | e.g. "Murphys, CA" when known (powers the local-act highlight) |
| `is_local` | derived flag for corridor/Calaveras acts (the AEO priority set) |

**Linkage: no schema change to `hwy4_events`.** Events already carry `artists text[]`. An event links to an artist row by normalized-name match at read time (the same `normalizeName` used for the key). This avoids a migration on the big events table and tolerates the array cleanly (an event can list two acts → two `ArtistInfo` blocks).

Migration: `supabase/migrations/2026XXXX_artists.sql`.

## 6. The drafter (clone the venue-address queue)

`lib/agent/draft-artist-blurbs.ts`, structurally identical to `lib/agent/draft-venue-addresses.ts`:

- **Worklist:** distinct `artists[]` values across upcoming `live_music` events that have **no** `hwy4_artists` row yet (or a row with `blurb IS NULL AND blurb_draft IS NULL AND blurb_draft_at IS NULL`). Idempotent + self-limiting; `blurb_draft_at` stamps even on an empty/ambiguous result so a no-signal act isn't re-researched daily.
- **Research:** new `lib/agent/research-artist.ts` (clone `research-venue.ts`), Sonnet + `web_search`, prompted to (a) find the act's own site/Spotify/Bandcamp, (b) return a genre + a two-sentence draft **only** when one act clearly matches with a local/regional corroborating signal, (c) return `confidence: low` + no prose otherwise, (d) return every source URL. Voice-injected via `withVoice()`; hard-refuses em-dashes / banned phrases like the venue drafter.
- **Cron:** daily route `/api/agent/draft-artist-blurbs` (a new `agent`-family cron in `vercel.json`), `?limit=N`, `?name=` to (re)draft one. Advisory only — never writes live `blurb`/`genre`.

## 7. Admin review — `/admin/artists`

A Pulse-tab review surface cloning `/admin/venues` (page + `actions.ts`, Basic Auth): list acts (missing-blurb first), each card showing the draft genre + prose + **its source links + confidence**. **Save** publishes `genre`/`blurb`, clears the draft, and captures the approved fact to `local_facts` (same KB feedback loop as blurbs). **Discard** clears the draft text but keeps `blurb_draft_at` as the "human declined" marker. Nav badge = count of pending drafts. The machine never publishes voice copy — a human Save is the only path to the live column, identical to the venue contract.

## 8. Rendering

- **`components/ArtistInfo.tsx`** (server component, sibling to `VenueInfo.tsx`): renders the genre chip + prose blurb + outbound links, gated to `category==='live_music'`, renders nothing when the artist is unknown (Tier C).
- **Card:** the existing `artists` chip in `EventCard.tsx` stays; optionally append the genre tag when present.
- **Detail page** (`app/events/[slug]/page.tsx`): mount `ArtistInfo` for each matched artist, above/beside `VenueInfo` — this is the Phase 2 "compose the night" block finally getting its band ingredient.
- **JSON-LD:** add `performer` (MusicGroup) to the event schema when an artist row exists — a clean structured-data win.

## 9. Phasing (ship small, watch behavior)

- **Phase 1 — data + drafter + review, no public render.** Table, migration, drafter, `/admin/artists`. Drain the ~30–50 distinct upcoming acts into review; Rob approves. Proves the accuracy/effort economics before anything goes public. *(This is the whole "is it worth it" test.)*
- **Phase 2 — render on the detail page.** `ArtistInfo` + genre chips + `performer` JSON-LD. The visible payoff.
- **Phase 3 (bet) — `/artists/[slug]` hub pages + a `/live-music` surface.** Durable per-artist URLs are the real SEO play ("who is <local band>"), mirroring the venue hub pages (`/venues/[slug]`). Build only if Phase 2 behavior asks for it.

## 10. Open decisions for Rob

1. **Genre chip alone as an MVP?** Cheapest, near-zero hallucination risk, still useful. We could ship *just* the chip first and add prose later. (Recommendation: build the full Phase 1 pipeline but let the review queue decide per-act whether prose is worth publishing.)
2. **Local-act priority.** Worth hand-writing the ~5–10 true Calaveras/Sierra locals first (highest AEO value, and Rob likely knows them personally — the highest-trust source we'll ever have), letting the drafter handle the touring long tail.
3. **Hub pages now or later?** `/artists/[slug]` is the SEO prize but adds thin-page risk for one-off acts — recommend gating it behind an "≥N upcoming events" advertise-in-sitemap rule exactly like the venue hubs.
