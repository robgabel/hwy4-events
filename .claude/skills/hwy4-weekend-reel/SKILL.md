---
name: hwy4-weekend-reel
description: Makes the weekly "Millie's weekend picks" vertical video for hwy4events.com, a 9:16 MP4 with an original rights-clean soundtrack, thumbnails, and a Facebook caption, built from the site's live Friday-to-Sunday listings. Use this whenever Rob asks for the weekend reel, the weekend video, Millie's picks, a Facebook or Nextdoor video for Hwy 4 Events, or anything like "make this week's video", "do the reel for next weekend", or "promote this weekend's Hwy 4 events", even if he doesn't say "skill" or "reel".
---

# Hwy 4 weekend reel

One reel per weekend, posted to Hwy 4 community Facebook groups (Thursday evening is the working hypothesis). The site's value is discovery, so the reel's job is to show locals what they'd otherwise miss and get them to hwy4events.com.

Each week gets one folder, `weekend-YYYY-MM-DD/` (the Friday). It holds the inputs (`events.json`, `reel_data.json`) and the outputs: `reel.mp4` (1080x1920, H.264 + AAC), `score.wav`, `thumb_9x16.png`, `thumb_4x5.png`, `qa_phone.png`, and `reel.html` (a silent playable page). The caption goes in the reply.

## Where things live (works in claude.ai and Claude Code)

- **`SKILL_DIR`** is the folder containing this file. In Claude Code, run scripts from the repo root as `python .claude/skills/hwy4-weekend-reel/scripts/...`; in claude.ai, use the skill's mounted path.
- **Week folders** resolve automatically (`scripts/paths.py`): `/mnt/user-data/outputs/weekend-YYYY-MM-DD/` when that sandbox exists, otherwise `out/weekend-YYYY-MM-DD/` at the root of the git checkout (whatever directory the session is in; hwy4-events ignores the root `/out/`), or `./out/` outside a checkout. Set `HWY4_REEL_OUT` to override. Renders are never committed.
- **First run on a new machine:** `python SKILL_DIR/scripts/check_env.py` lists anything missing (playwright + chromium, ffmpeg, numpy, scipy, pillow) with the install command for each.
- **Claude Code cloud sessions:** Chromium is preinstalled, so don't run `playwright install`; `pip install` the playwright version that matches it (`playwright==1.56.0` matched `chromium-1194` on 2026-10-08) plus `scipy`. Set `HWY4_REEL_OUT` to the session's scratchpad so Rob can open the files, and send `reel.mp4` + `thumb_4x5.png` with the file-send tool. The container's proxy may block hwy4events.com, in which case `fetch_weekend.py` fails; use the Supabase fallback in step 1.
- **Voice:** if the repo has `VOICE.md`, follow it for on-screen copy and the caption. It wins over the examples here.

Out of scope for now: per-town cuts (one reel for all groups). Rob may add them later.

## Workflow

1. **Pull the weekend.** `python SKILL_DIR/scripts/fetch_weekend.py` (add `--friday YYYY-MM-DD` to override; default is the next Friday after today's Pacific date, so a UTC machine on Thursday evening still gets this weekend). It writes `events.json` into the week folder and prints the listings. It reads the schema.org Event data on `/this-weekend?from=<fri>&to=<sun>`, which is what readers see after the site's quality filters, and adds each card's weather line. That list is capped at 100 events; if a busy weekend overflows it, the script stops with an error instead of undercounting. If it returns nothing, looks thin, or can't reach the site, query Supabase (project `uzediwokyshjbsymevtp`) with the site's own public filters:
   ```sql
   select name, date, start_time, end_time, town, venue_name, category, robs_pick, artists, price, cost_tier, description
   from hwy4_events
   where date between '<fri>' and '<sun>'
     and visibility = 'public' and coalesce(status,'') <> 'cancelled' and is_routine is not true
   order by date, start_time nulls last;
   ```
   The end card's count is the number of rows (a play with three performances counts three times, as on the site).
2. **Pick, discovery first.** See "Editorial picks." Read the event pages (`https://hwy4events.com/events/<slug>`) for your picks; the descriptions hold the specific, surprising details that make a scene (e.g., "bring leaves to press into the clay", "wine slushies").
3. **Verify every on-screen claim** against the listing: time, venue, town, price or "free", weather. If a claim needs a footnote to be true, cut it from the screen and put the nuance in the caption. Examples: the Big Trees hike is free "with the $10/vehicle park entrance", so it goes on screen as "$10/car park entry", not "Free". A workshop that is "handbuilding" gets a slab-rolling animation, not a potter's wheel.
4. **Write `reel_data.json`** into the week folder (schema below; `assets/example_reel_data.json` is a full worked example).
5. **Render.** `python SKILL_DIR/scripts/render.py <week folder>/reel_data.json` (output defaults to the same week folder; 30fps; a 60s reel takes about 3 minutes).
6. **QA.** View `qa_phone.png` and run the checklist. Fix and re-render if anything fails.
7. **Deliver.** In claude.ai, present `reel.mp4` and `thumb_4x5.png`; in Claude Code, give the path to the week folder. Keep the reply short and in this order:
   - the picks by day, one line each;
   - judgment calls (events skipped and why, conflicting times, art chosen to match the facts);
   - a one-line music note (original score, you can't hear it, Rob should listen once);
   - the caption, in a quote block, ready to paste.

## Formats

- **Long (default, 60s):** a hook, a divider for each of the three days, about 10 discovery picks, a "big ones" list, and the end card. Durations: hook 4s, divider 2s, event 4s, list 6s, end 4s. Adjust the pick count so the total lands at 60s.
- **Short (about 20s):** a hook plus 3 or 4 events and the end card, with no dividers. Use it when Rob asks for short, or for a thin weekend.

**Keep every scene's `dur` a multiple of 2 seconds.** The score is 120 BPM (one bar = 2s), so this makes every cut land on a downbeat.

## Social spec (why the template looks like this)

These came from a cold review of the first horizontal version. Keep them unless Rob changes them.

- **9:16 master, feed-safe center.** Facebook shares all videos as Reels and shows a 4:5 center crop in the feed. Keep key content between y=285 and y≈1500, inside x 70 to 1010. Below y≈1536, Reels UI covers content.
- **Frame 0 is the hook.** The first scene renders fully composed at t=0 (no fade-in, no logo opener). In the long format the hook names the obvious event and promises what's beyond it ("Beyond the Grape Stomp / 10 more weekend picks").
- **Phone-legible text.** Nothing under ~42px on the 1080-wide canvas. The template sizes type; cut copy rather than shrinking it.
- **Millie is the host.** The "Millie's weekend picks" badge persists over the scenes, and Millie closes the end card.
- **No product-demo scenes.** Show events, not the app.
- **Accuracy over hype.** In a small group, one wrong claim gets corrected in the comments and becomes the story.
- **The frog is the closing sting,** not the opener.

## Editorial picks

Discovery first: lead with things a local might not know are happening. Rank candidates by:
1. **Novelty.** A hands-on experience (make, taste, build), a first or annual one-off, an opening night, a small venue.
2. **A concrete, specific hook** from the description that fits in a 2-line title: "Blend your own wine", "Art studio treasure hunt", "Free music + wine slushies".
3. **Open to the public.** Skip members-and-guests events (the venue notes on the site flag these; the Ebbetts Pass Moose Lodge is a common one) and anything whose access is unclear.
4. **Clean facts.** If listings conflict (e.g., two times for the same dinner), use a range like "Saturday evening" on screen and explain it in the caption, or skip the event.
5. **Spread across towns and types** when it's close.

The obvious headliners (big concerts, the Grape Stomp, anything everyone already knows) go in the `list` scene near the end as "And yes, the big ones." A `robs_pick` event is usually the obvious one; put it last in the list so the reel closes on it.

**Check last week's reel before picking.** Weekly regulars (Boyle MacDonald rooftop music, the Murphys farmers market, Stevenot Sundays, the South Grove hike) recur every week, and the same groups see every reel. Prefer picks that weren't in last week's reel; a multi-week run that already got its own scene (a play's opening night) can move into the big-ones list. If that leaves the weekend thin, run the long format shorter (48s is fine) rather than padding with repeats.

Memorials and fundraisers are fine to feature with a straight, respectful title. Never use them for jokes or gimmicky art.

## Scene schema

`reel_data.json`:
```json
{
  "friday": "2026-10-02", "weekend": "Oct 2 to 4", "thumb_time": 2.9,
  "aria": "One-sentence description of the whole reel for screen readers",
  "scenes": [
    {"theme": "sunrise", "art": "stomp", "chip": "Oct 2 to 4 on Hwy 4", "title": ["Beyond the", "Grape Stomp"], "support": "10 more weekend picks", "dur": 4},
    {"layout": "divider", "theme": "night", "art": "beams", "big": "Friday", "sub": "Oct 2"},
    {"theme": "night", "art": "blend", "chip": "Friday, 5 PM", "title": ["Blend your", "own wine"],
     "support": "Wine Blending Night", "detail": "Murphys Wine & Beer Garden", "pill": "Ticketed"},
    {"layout": "list", "theme": "night", "art": "beams", "chip": "Also this weekend", "title": ["And yes,", "the big ones"],
     "items": [{"what": "Lynyrd Skynyrd, Fri 7 PM", "where": "Ironstone Vineyards"}]}
  ],
  "end": {"wordmark": "Hwy 4 Events", "line": "All 17 weekend events at", "url": "hwy4events.com", "dur": 4}
}
```
See `assets/example_reel_data.json` for a full 60-second weekend.

- `layout`: `event` (default), `divider`, or `list`.
- `theme`: `night` (dark forest, stars), `sunrise` (sunset gradient), or `trees` (pine with sequoia trunks at the edges). Use one theme per day: Friday night, Saturday sunrise, Sunday trees. Entering a new theme gets a themed wipe (drop from the top, rise from the bottom, or a sequoia sweep). Same-theme scenes slide in from the right.
- `chip`: the day and time ("Friday, 5:30 PM"). Write "5 PM" rather than "5:00 PM".
- `title`: 1 or 2 lines, about 12 characters per line. Write the hook ("Make your own mug"), not the event name. It auto-shrinks to fit.
- `support`: the real event name (gold). `detail`: venue and town, one line. `pill`: optional price, access, or run dates.
- `divider`: `big` (day name) and `sub` (date). `list`: `items` of `{what, where}`, at most 2.

## Art library (`ART` in `assets/reel.html`)

Event art sits in the zone y 1200 to 1490, under the text. Choose the module that fits the event honestly.

| key | what it animates | use for |
|---|---|---|
| `stomp` | grapes pop in, a boot stomps them (lands at 2.0s, synced to a boom) | the hook, wine or harvest festivals |
| `blend` | three wines drip into one glass | wine blending, tastings |
| `slab` | clay slab rolled out, leaf and pine-needle texture, wrapped into a mug | pottery and hand-craft workshops |
| `lights` | rooftop string lights switch on | patio or rooftop music, evening socials |
| `lighthouse` | lit lighthouse beam through drifting mist | theater, ghost stories, spooky or maritime |
| `map` | paper map, dotted route draws, pins drop | art crawls, tours, open studios |
| `hat` | cowboy hat drops in with sparkles | rodeo and western events |
| `pumpkins` | pumpkins pop onto a crate by a flowing creek | farmers markets, fall harvest |
| `trail` | dotted trail climbs through trunks, hiker dot | hikes, walks, nature |
| `notes` | music notes float up | music festivals, concerts |
| `slushie` | a cup fills with wine slush, straw pops in, notes | casual winery music, food-and-drink days |
| `beams` | sweeping stage spotlights | dividers, headliners, the big-ones list |
| `sun` | a sun rises | daytime dividers |
| `carshow` | a classic car idles (or rolls in when not the hook), hops on the 2.0s beat with a boom, chrome sparkles | car shows, cruise nights, the hook when a car show is the obvious event |
| `gift` | a gift box drops in, the lid pops on the 1.5s beat, confetti and three balloons rise | anniversaries, grand openings, giveaways, parties |

**Adding art.** If a pick deserves its own animation (fireworks, snowfall, a parade), add a module with `build(svg, s)` and `render(tau, s, t)` next to the others, where `tau` = seconds since the scene started. Use palette colors (`C` object) only, check each color against every theme it might sit on (a `sunset` element vanishes on the `sunrise` background), stay in the art zone, and add at most two new modules per week. Mention new modules in the reply so Rob knows the library grew.

## Music

`render.py` calls `scripts/make_music.py`, which composes an original track from scratch: a plucked-string guitar, bass, drums, and glockenspiel at 120 BPM in G. The arrangement follows the scenes (intro, lift on dividers, a groove per theme, a boom on the grape stomp or the car hop, a crash on the gift lid pop, a plink for every frog hop). With no samples or recordings, there is nothing for Rights Manager to match. The file also gets `score.wav` in case Rob wants to reuse or swap it.

Rules:
- **Never use the headliner's recordings** or anything from Facebook's consumer Reels music picker. That catalog is licensed for personal, non-commercial use, and a post promoting Hwy 4 Events is promotional.
- **If Rob wants a more polished track,** use Meta's Sound Collection (Meta Business Suite): it's cleared for commercial use on Facebook and Instagram, but the license is Meta-only. Paid multi-platform libraries (Epidemic Sound, Artlist) are the option if he cross-posts.
- **Claude can't hear the score.** Say so, and have Rob listen once before posting. Integrated loudness should land around -14 to -16 LUFS (check with `ffmpeg -i score.wav -af ebur128 -f null -`).

## QA checklist (look at qa_phone.png)

The sheet shows every scene at phone width. Blue lines mark the 4:5 feed crop and the red line marks the Reels UI zone.

- [ ] Frame 0 alone says what, when, and where.
- [ ] Every title fits (none clipped at the right edge), and all text is readable at this size.
- [ ] Nothing important sits below the red line or outside the blue lines.
- [ ] Each claim matches its listing (step 3), and each art module fits its event honestly.
- [ ] No copyrighted logos, album art, or band photos. Band names as plain text are fine.
- [ ] `reel.mp4` has an audio stream, unless `--silent` was used.

## Caption template

Video text is small in a feed, so the caption carries the details. Facebook truncates after about two lines, so the first line must stand alone. Match `assets/example_caption.md`:

```
Millie's weekend picks for Hwy 4 ({weekend}) 🐾 Beyond {obvious event}:

Fri: {hook-style pick} ({time}, {venue}) · {pick} ({time}, {venue}, {price}) · ...
Sat: ...
Sun: ...

And the big ones: {headliner} {day}, {headliner} {day}.

{A discovery question, e.g. "Which one had you never heard of? 👀"}

All {count} events: https://hwy4events.com/?utm_source=facebook&utm_medium=group&utm_campaign=weekend-{friday}
```

- Put one line per day, with picks separated by " · ", in the same order as the video.
- Put fine print inline, in the pick's parentheses: park fees, prices, "free", and conflicting listing times ("listings say 5 and 6 PM, check tickets").
- Describe each pick the way the video does ("Blend your own wine"), not by its official title, unless the title is the hook.
- Ask a question about discovery, not about one event. It invites comments from people who didn't find a pick they liked.
- Never use engagement bait like "comment YES"; Meta demotes it.

## Posting notes for Rob (include briefly the first few times)

- Post as Rob, not a Page. Get admin approval where groups require it, and ask for a standing weekly slot.
- Space posts across groups rather than blasting them within minutes. Add `&utm_content={group-slug}` per group.
- Tag or notify the featured venues when a group allows it.
- The experiment is 3 weekends against the static share card, comparing 3-second views, completions, shares, and link clicks. For the long format, also watch the average watch time; 60s trades completion rate for coverage.
