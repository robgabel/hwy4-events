# PRD: Make Hwy4Events Feel Like a Local Built It

**Author:** Rob Gabel
**Date:** 2026-03-13
**Status:** Draft
**Codename:** "The Cabin Project"

---

## The Problem

Hwy4Events is functional, clean, and well-organized. It also looks like every other AI-generated Next.js site on the internet. The color palette is tasteful but generic ("nature-inspired earth tones"). The typography is Inter. The mountain SVGs could represent any mountain range. The copy is polite and informative. Nothing about it says "a guy who's had a cabin in Arnold for 11 years made this because he kept missing shows at the Lube Room."

**The irony:** the site's biggest asset — that it's built by an actual local who genuinely uses it — is invisible in the design.

## The Insight

Authenticity isn't a visual style. It's specificity. A polished site can feel local if it's full of details that could only come from someone who lives there. A rough site can feel generic if it's full of stock imagery and safe copy.

The goal isn't to make the site look homemade. It's to make it feel *inhabited*.

## Design Principles

1. **Specific over generic.** Every design choice should answer: "Could this exist for any mountain town in America, or only for the Hwy 4 corridor?" If the answer is "any," it's wrong.

2. **Opinionated over neutral.** A local has opinions. The site should too. Not everything needs editorial voice, but the moments where Rob's perspective shows through are the moments the site comes alive.

3. **Warm over polished.** The current site is slightly too "designed." The goal is the feeling of a well-kept cabin — clean, intentional, but clearly personal. Not a hotel lobby.

4. **Earned detail over decoration.** Don't add visual complexity for its own sake. Every element should carry meaning that a local would recognize.

---

## Workstream 1: The Header — "You Are Here"

**What's wrong now:** The header is a gradient with abstract SVG mountains that could be the Rockies, the Cascades, or a WordPress theme. The pine tree icons are clip art. The town list reads like a data dump.

**What it should feel like:** Arriving. Cresting the hill past Copperopolis, pine smell hitting, knowing you're almost there.

### Changes

**1.1 — Hero photography, not illustration**

Replace the gradient + SVG combo with a real photograph of the corridor. Rob's own photos are ideal — even an iPhone shot of Hwy 4 through the pines, the view from Spicer Reservoir, or fall colors near Dorrington. Rotate seasonally (4 photos, one per season). Overlay text on a subtle dark gradient for readability.

- **Spring:** Wildflowers or green foothills near Angels Camp
- **Summer:** Blue sky through tall pines, or a lake/reservoir shot
- **Fall:** Gold and red leaves on the road near Arnold/Dorrington
- **Winter:** Snow-covered pines or the road with chain controls

If Rob doesn't have photos ready, start with a single strong shot and expand later. A real photo of a real place beats four stock images.

**1.2 — Typography with character**

Replace Inter with a font pairing that has more personality:
- **Headlines:** A slightly rugged serif or slab-serif. Candidates: `Bitter`, `Libre Baskerville`, `Source Serif Pro`. Something that reads "mountain town newspaper" not "SaaS landing page."
- **Body:** Keep a clean sans-serif but move to something slightly warmer than Inter. `DM Sans`, `IBM Plex Sans`, or even `Source Sans Pro`.

The site title "Hwy 4 Events" should feel hand-set, not machine-generated. Consider a custom SVG wordmark instead of plain text — doesn't need to be fancy, just distinctive.

**1.3 — Tagline with soul**

Replace "and everywhere in between" with something that only a local would write:

- *"From the Frog Jump to the summit"*
- *"Everything happening between Angels Camp and Bear Valley — from a guy who's been showing up for 11 years"*
- *"Your cabin weekend, planned"*

Pick one line. It should make a local smile and a tourist curious.

**1.4 — Kill the SVG mountain range**

The detailed multi-layer mountain SVG in the header is the single most "AI-generated" element on the site. Remove it entirely. The photo does the work now.

Keep the wavy cream divider at the bottom of the header — it creates a nice transition. But simplify it to a single clean wave, not a mountain silhouette pretending to be a divider.

---

## Workstream 2: The Voice — "A Friend Who Lives There"

**What's wrong now:** The intro copy is good ("Never miss a Lube Room show again :)") but it's an island of personality in a sea of neutral language. The rest of the site reads like a well-mannered CMS.

### Changes

**2.1 — Seasonal greeting in the header area**

Add a single rotating line below the tagline that changes with the season/conditions. Not automated — Rob updates it manually when he's up at the cabin, which is the point.

Examples:
- *"Chains required past Dorrington this weekend. Worth it."*
- *"Patio season at Murphys Hotel starts now."*
- *"The Frog Jump is in 3 weeks. You've been warned."*
- *"Bear Valley just got 2 feet. See you up there."*

Store in Supabase as a simple `site_message` field. If null, don't show anything. The irregularity is a feature — it signals a human behind the curtain.

**DB change:** Add a `site_config` table (or a single row in an existing config table):
```sql
create table site_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);
insert into site_config (key, value) values ('greeting', null);
```

**2.2 — "Rob's Pick" badge**

Add a `robs_pick` boolean column to `hwy4_events`. When true, show a small badge on the event card — something like a simple star or checkmark with "Rob's Pick" in the accent color. No more than 1-2 active at a time. This is the single strongest signal that a human curates this site.

The badge should be understated. Not a giant banner — just a small indicator next to the event name, similar in weight to the "Tentative" badge.

**2.3 — Venue tips (future, optional)**

Add an optional `tip` text field to events or venues. Short, first-person notes:
- *"Parking fills up fast — get there early"*
- *"Grab the tri-tip sandwich while you're here"*
- *"Bring a blanket, the lawn seating is the move"*

These appear as a subtle italic line below the event description on the detail page. Not every event needs one. Scarcity makes them more valuable.

**2.4 — "Last checked" timestamp**

Replace "Data refreshed daily" in the footer with a human-readable timestamp: *"Last checked Tuesday morning"* or *"Updated March 12."* This is a subtle but powerful authenticity cue — it implies someone looked, not that a cron job ran.

Pull from the most recent `last_scraped_at` value in the events table, but display it in casual language, not ISO format.

---

## Workstream 3: Sense of Place — "This Road, Not Any Road"

**What's wrong now:** The towns are listed but there's no spatial sense of the corridor. A visitor can't feel the geography — the climb from Angels Camp (1,300 ft) to Bear Valley (7,000 ft), the way the pines get taller, the way each town has its own character.

### Changes

**3.1 — Corridor elevation strip**

Add a subtle, horizontal "elevation profile" element to the filter bar or just below it. A thin strip showing the towns arranged left-to-right in geographic order with approximate elevation:

```
Angels Camp     Murphys     Avery     Arnold     Dorrington     Bear Valley
  1,300 ft       2,100 ft    2,800 ft   4,000 ft    4,800 ft       7,000 ft
```

Style it as a gentle rising line (like a trail elevation chart) with town names as labels. When a user filters by town, that town highlights on the strip. This instantly communicates the geography in a way that only this corridor could have.

Keep it minimal — a thin SVG, not a full map. It should feel informational, not decorative.

**3.2 — Town character in the filter**

When a town is selected in the dropdown (or when the corridor strip is used), show a one-line description:
- Angels Camp: *"Gold Rush gateway town — 1,300 ft"*
- Murphys: *"Wine country in the pines — 2,100 ft"*
- Arnold: *"Heart of the corridor — 4,000 ft"*
- Bear Valley: *"Alpine resort at the summit — 7,000 ft"*

One line, visible only when filtered. Gives newcomers a sense of place without cluttering the default view.

**3.3 — Drive times from the cabin**

On event detail pages, show approximate drive time context:
- *"25 min from Arnold"* or *"At the top of the hill"*

Use Arnold as the reference point (where Rob's cabin is). This is an opinionated choice and that's the point — it signals a real person with a real location.

Implement as a simple lookup table of town-to-town drive times, not a maps API call.

---

## Workstream 4: Visual Identity — "Cabin, Not Corporate"

**What's wrong now:** The design is clean but antiseptic. Every element is perfectly rounded, perfectly spaced, perfectly consistent. Real things have texture.

### Changes

**4.1 — Texture and warmth**

- Add a subtle paper/linen texture to the cream background. Not heavy-handed — just enough to break the flatness of a pure CSS background. A repeating 200x200px texture at 3-5% opacity.
- Event cards: keep the white background but add a very subtle warm shadow instead of the current neutral one. Cards should feel like they're sitting on a wooden surface, not floating in space.

**4.2 — Accent details**

Replace the generic SVG tree icon (used in header and footer) with a small custom icon set that's specific to the corridor:
- A simple pine tree that's less symmetrical (real pines aren't perfect triangles)
- A small frog silhouette (Frog Jump is the corridor's most famous event)
- A grape cluster (Murphys wine country)
- A ski/snowflake (Bear Valley)

Use these contextually — frog near festival events, grape near Murphys events, etc. Don't over-design them. Simple 1-color silhouettes.

**4.3 — Color refinement**

The current palette is fine but could be more specific:
- The greens should feel like *these* pines, not generic "nature green." Pull colors from actual photos of the corridor.
- Add a gold/amber accent pulled from the Gold Rush history and fall foliage. Use it for the "Rob's Pick" badge and special callouts.
- The sunset orange is good — lean into it more for live music events.

**4.4 — "Up Next" card treatment**

The current "Up Next" card has a pulsing green dot that feels like a SaaS dashboard notification. Replace it with something warmer:
- A subtle highlight bar or glow on the left edge
- The text "Up Next" in a handwritten-style font or a warmer badge style
- Remove the pulsing animation — it's the most "tech product" element on the page

---

## Workstream 5: Millie — "The Mascot That Proves a Human Made This"

**The idea:** Rob's sheepadoodle Millie is a black-and-white ball of charm that everyone who meets her loves. She's the cabin dog. She comes up every weekend. She's as much a part of the Hwy 4 experience as the pines and the wine. Making her the site's mascot is the single most effective anti-AI move possible — no algorithm would think to put a specific real dog on an events site. A person would.

**Art style:** Rob has clean black-and-white cartoon line-art illustrations of Millie in two poses:
- **Lying down** — relaxed, paws forward, looking content (the "porch dog" pose)
- **Front-facing** — happy, mouth open, tail up (the "greeting you at the door" pose)

These are perfect as-is. The line-art style is distinctive, reproducible at any size, and reads well in both color and monochrome. Don't over-render or add shading — the simplicity is the charm.

### Where Millie Appears

**5.1 — Favicon and logo mark**

Replace the generic pine tree SVG with a tiny Millie silhouette (lying-down pose, simplified to work at 32x32px). This is the single highest-visibility change — she shows up in every browser tab. Make it work as a simple black silhouette on white, and white on dark.

**5.2 — Header companion**

Place a small cartoon Millie (lying-down pose, ~40-50px tall) next to or below the site title in the header. She's not the logo — she's *next to* the logo, like she's hanging out on the porch while Rob updates the site. On mobile, she can tuck under the title. On desktop, she sits to the right of the title or below the tagline.

Keep her small. She should feel like an Easter egg that regulars notice and love, not a mascot plastered across the page.

**5.3 — Empty states and error pages**

The "No events found" empty state currently shows a generic calendar icon. Replace it with the front-facing happy Millie illustration and copy like:
- *"Nothing matching those filters. Millie's bored too."*
- *"No events found — try clearing your filters."* (with Millie napping illustration)

The 404 page: Millie with a quizzical head-tilt, *"Millie can't find that page either."*

**5.4 — Footer**

Replace the pine tree SVG in the footer with a small Millie silhouette. She bookends the page — in the header when you arrive, in the footer when you leave.

**5.5 — Rob's Pick badge (tie-in with Workstream 2)**

Instead of a star or checkmark, the "Rob's Pick" badge uses a tiny Millie paw print icon. Rob picks it, Millie stamps it.

**5.6 — Seasonal Millie variants (future, stretch goal)**

Once base illustrations are in place, consider seasonal variants:
- **Winter:** Millie in the snow or with a scarf
- **Summer:** Millie at the lake
- **Fall:** Millie in leaves

Low priority but high delight. Would rotate with seasonal header photography.

### Where Millie Does NOT Appear

- **Not on every event card.** Mascot overload. She's ambient, not omnipresent.
- **Not animated or bouncing.** Millie is chill. She's on the porch. No GIFs, no wiggle animations.
- **Not photo-realistic.** The line-art cartoon style is the brand. Keep it consistent.
- **Not talking.** No speech bubbles, no "Millie says..." That's corporate mascot energy. She's just there. Being a dog. That's enough.

### Implementation

Convert cartoon illustrations to optimized SVGs (or small PNGs with transparency) at key sizes:
- **Favicon:** 32x32 silhouette (simplified)
- **Header:** ~50px height, line-art with detail
- **Empty state:** ~120px height, full illustration
- **Footer:** ~24px height, simplified silhouette

The lying-down pose and the front-facing pose are the two core assets — everything else derives from those.

---

## What NOT to Do

- **Don't make it look "rustic" or "woodsy" in a theme-park way.** No faux wood borders, no rope textures, no cartoon bears. That's tourist kitsch, not local authenticity.
- **Don't add a map.** A full interactive map is scope creep and the elevation strip does the job better. Maps say "platform," the strip says "this road."
- **Don't over-personalize.** Rob's voice should be present but not dominant. The events are the star. Rob is the trusted curator, not the subject.
- **Don't sacrifice mobile performance.** Photo headers need to be optimized. Textures need to be tiny. The site should still load fast on spotty mountain cell service.
- **Don't add social features.** No comments, no likes, no user accounts. That's platform thinking. This is a bulletin board with one trusted author.
- **Don't make Millie cutesy.** She's a real dog, not a brand character. Treat her with the same restraint as the rest of the design. Less is more.

---

## Implementation Priority

| Phase | Items | Effort | Impact |
|-------|-------|--------|--------|
| **1 — Voice + Millie** | Rob's Pick badge (paw print), seasonal greeting, "last checked" timestamp, tagline rewrite, Millie favicon + header | Small | Highest |
| **2 — Place** | Elevation strip, town one-liners, drive times | Medium | High |
| **3 — Visual** | Photo header (start with 1 photo), font swap, kill mountain SVG | Medium | High |
| **4 — Texture** | Paper background, card shadows, icon refinements, Up Next restyle | Small | Medium |
| **5 — Millie expansion** | Empty states, 404 page, footer, seasonal variants | Small | Medium |

**Phase 1 first.** Voice + Millie together are the fastest path to "a real person made this." The paw print favicon alone does more work than any visual redesign. Combined with Rob's actual voice in the seasonal greeting and a tagline with soul, the site transforms from "clean event aggregator" to "Rob's cabin project, featuring his dog."

---

## Success Criteria

The site passes the "local test": if someone from Arnold or Murphys lands on it, do they think "oh cool, someone local made this" or "oh, another events aggregator"?

Secondary: if someone shares the link in a Calaveras County Facebook group, does the response skew toward "this is great, who made this?" or silence?

The answer should be obvious from the first 3 seconds on the page.
