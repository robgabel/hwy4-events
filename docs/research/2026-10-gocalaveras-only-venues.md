> **Status (2026-10-06):** Read-only audit for issue #359. No scraper in this doc. The Prospect 772 companion scraper is draft PR #360. Follow-up issues are listed here and were not filed.

# GoCalaveras-only venues (October 2026)

Which upcoming venues exist on the site only because GoCalaveras listed them, and which of those have an original calendar that would add the band, the end time, or a ticket.

## Method

Read-only SQL against project `uzediwokyshjbsymevtp` on 2026-10-06. A venue is in the set when every upcoming public row (`date >= 2026-10-06`, `visibility = 'public'`, not cancelled, not routine, `venue_key` not null) has `org_slug = 'gocalaveras'`. Ten venues, 36 rows. Each row's `source_name` is `GoCalaveras.com`.

`org_slug` is written on insert and left alone on a later merge. A night that GoCalaveras inserted, then an organizer scraper enriched, still counts as GoCalaveras-only. Prospect 772 will stay in this set after PR #360 merges onto the two existing rows, until a show is inserted under `org_slug = 'prospect-772'`.

Venues that already have another writer are out of the set: `murphys-creek-theatre`, `murphys-community-park`, and `wine-beer-garden` (Visit Murphys), and `murphys-irish-pub` (the pub's own Wix scraper).

Original sources were checked the same day with a browser-like GET. That is a probe of the public page, not a scrape into the database.

## Ranked by reader impact

Generic titles first. A card that does not name the act is worse than a card that is missing an end time.

### 1. `watering-hole`: The Watering Hole, Murphys

4 rows, Oct 8 / 15 / 22 / 29. Every title is `Thursday Summer Concert Series @ The Watering Hole`. `artists` is an empty array. Start 17:00, end 19:00, price null. The description is the same series blurb ("featuring local bands"); it names no act.

**Original source.** https://murphyswateringhole.com/ and `/events` both returned HTTP 403 (Cloudflare) on 2026-10-06. No readable lineup. The 2026-07-25 canonical-page audit already rejected the homepage. Facebook was not confirmed as a page that publishes event objects.

**What it would add.** The band, which is the whole gap. Ends are already present.

**Scraper.** Do not build one until a page we can actually read names the act. Highest generic-title harm in the set, and no confirmed parseable source.

### 2. `prospect-772`: Prospect 772 Winery, Angels Camp

2 rows, Oct 10 and Oct 24. Hand-retitled on Oct 5 to `Breakaway Live Music @ Prospect 772` and `Boomer Live Music @Prospect 772 Winery`, with artists set and end 21:00. Price is still null. `event_url` is still the GoCalaveras permalink. Before the hand edit these were `Live Music @ Prospect 772` with `artists` null.

**Original source.** https://www.prospect772.com/calendar is Square Online. The CMS page lists `featuredEventIds`. The products API returns the act in the product name, `start_time` / `end_time` (5:00 PM–9:00 PM), the permalink, and the online price ($12.77 and $17.72). Facebook page `Prospect772` was probed 2026-09-05 with zero upcoming events (`scripts/scrapers/hwy4-fb-pages.ts`).

**What it would add.** Ticket price, ticket URL, and a title that does not depend on a hand edit. The two live rows already have the band and the end.

**Scraper.** Draft PR #360. Registered last, not blocklisted. An INSERT of a show GoCalaveras has not listed yet needs a `hwy4_orgs` row for `prospect-772`, which that PR does not add.

### 3. `angels-camp-museum`: Angels Camp Museum

2 rows, Oct 11 and Nov 8, both titled `The Angels Camp Museum Lecture Series`, 13:00, no end, no price, no artists. The Oct 11 description names the speaker (Kelly Gerkensmeyer, Calaveras County Water District). The card title does not.

**Original source.** https://angelscamp.gov/museum-park/ returned 200 and does not mention a lecture. `angelscampmuseum.com` did not resolve when probed earlier the same day. No dated lecture feed was found.

**What it would add.** A speaker in the title, an end time, and a ticket or RSVP link, if a feed existed. The speaker is already in the description of the row we have.

**Scraper.** None until a dated source exists.

### 4. `stevenot`: Stevenot Winery, Murphys

4 rows. Three Sunday concerts already name the act (`Private Reserve`, `Greg Sutton`, `Perarez`), 13:00–16:00, two of them Free. Plus `Stevenot Winery Halloween Party` on Oct 30, 19:00–22:00, price null.

**Original source.** Tribe REST at `https://www.stevenotwinery.com/wp-json/tribe/events/v1/events` returned HTTP 200, `total` 15, on 2026-10-06. Same client shape as Arnold Rim Trail (`scripts/lib/tribe.ts`). The HTML events page is server-rendered as well.

**What it adds over GoCalaveras, checked against the live feed:**

- Oct 25, 13:00–16:00. Our row is `Perarez Live Music @ Stevenot Winery`. Stevenot's own event is `Skull Country – FREE Live Music`. Same clock, different act.
- Oct 30 Halloween party. Our row is 19:00–22:00 with no price. Stevenot says 16:00–20:00 and `$25.00`.
- Sundays we do not list at all: Nov 1 Blue Neon Serenade, Nov 8 Couple of Beans, Nov 15 Caroline & Jesse, Nov 22 Honeywood, Nov 29 Gary Souza, Dec 6 Miss American Pie, Dec 13 Heidi Crook, Dec 20 Jill Warren, Dec 27 The Wise Guyz. Each is 13:00–16:00 and titled free.
- Also on their calendar and not in our feed: Oct 17 wine club release (sold out) and Nov 7 holiday open house.

**Scraper.** This is the next one to build. Clone `scripts/scrapers/arnold-rim-trail.ts`. Register it after GoCalaveras and do not blocklist GoCalaveras. The organizer feed is the correction for the Oct 25 act and the Halloween clock, and it is the only way the November and December Sundays show up with the right name.

### 5. `ironstone`: Ironstone Vineyards, Murphys

3 rows, all specific titles: Longevity & Lifestyle Conference (Oct 15, 08:00, no end, no price; description says 8:00 registration and 9:00 program), Firewise Calaveras Festival (Oct 17, 10:00–15:00, Free), Phantom of the Opera (Oct 30, 18:00, no end, $45).

**Original source.** https://ironstonevineyards.com/events/ returned 200. It is a poster grid (2026 concert series tiles, a Phantom tile linking to `/phantom2026/`), not a dated list of these three rows. Stripped text still has no per-event dates for them. The 2026-07-25 verification audit rejected this page for the same reason. Facebook was probed with zero upcoming events.

**What it would add.** Ends for the conference and Phantom, if a real listing stated them. The Phantom tile is one page, not a calendar.

**Scraper.** None. Re-check only if the events page becomes a dated feed.

### 6. `miners-lounge`: The Miners Lounge, Angels Camp

2 rows, Oct 8 and Oct 22: `Line Dancing with Mercedeez @ Miner's Lounge`, artists `["Mercedeez"]`, 19:00, no end, no price.

**Original source.** https://www.minerslounge.bar/events returned 200 (Squarespace). The HTML mentions line dancing once and does not name Mercedeez or any October date. No events collection to parse.

**What it would add.** An end time, if the venue ever publishes one.

**Scraper.** None until the Squarespace page has a real dated collection.

### 7. `lackler-ceramics`: Lackler Ceramics, Arnold

12 rows through Dec 10. Titles name the class (`Kids Clay`, `Making Smalls`). Most have a price (`$47 (online) or $45 (zelle/cash/check)` or `$45-$47`) and an end (15:00–16:30 or 16:00–18:00). One Kids Clay row (Oct 29) has no price. Artists are null because these are classes.

**Original source.** https://www.lacklerceramics.com/workshops returned 200. Wix. The registry comment in `scripts/lib/venues.ts` already points at that page.

**What it would add.** A booking link. The class name, clock, and price are already on the card.

**Scraper.** Optional, and only for the booking URL. Lower reader impact than Stevenot or the Watering Hole.

### 8. `fairgrounds`: Calaveras County Fairgrounds, Angels Camp

3 rows. `18th Annual – All Hallow's Faire` on Oct 24 (12:00–21:00) and Oct 25 (11:00–18:00), artists Harp Twins, Volfgang Twins, Celtica Nova, no price. `9th Annual Crafty Chicks Holiday Market` on Nov 21, 11:00–16:00, no price.

**Original source.** https://www.frogtown.org/ is the venue site. `/events` returned 404. The fairgrounds are multi-tenant (Frogtown Road plus the Gun Club Road gate). There is no single organizer calendar.

**What it would add.** Ticket prices, if each producer published one. Not one scraper.

**Scraper.** None.

### 9. `copperopolis-town-square`: Copperopolis Town Square

3 rows, all specific civic titles: Trick or Treat Street (Oct 31, 18:00–20:00), Veterans Day Parade (Nov 11, 11:00, Free), 17th Annual Chili Cook-Off (Nov 14, 11:00–15:00). The summer concert series is outside this window.

**Original source.** The venue's Facebook `/events` tab is already scraped by `hwy4-fb-pages` (`TheTownSquareAtCV`). That scraper is why concert nights pick up the act name. These three civic rows are not a missing scraper.

**Scraper.** None new.

### 10. `marisolio`: Marisolio Tasting Bar, Murphys

1 row: `Harvest Table Cooking Class`, Nov 6, 18:00, no end, no price. The description already says to call 209 728-8853 or visit 488 Main St.

**Original source.** Tribe REST at `https://marisolio.com/wp-json/tribe/events/v1/events` returned HTTP 200 and `total` 0. Same empty calendar the 2026-07-25 verification audit found.

**Scraper.** None. Re-check only if that feed starts returning events.

## Recommended next scrapers

Listed here so they can be filed as issues. They were not filed from this audit.

1. **Stevenot Winery Tribe scraper.** Highest leverage. The organizer feed disagrees with a live act (Oct 25 Perarez vs Skull Country), disagrees with the Halloween party clock and price, and lists nine later Sunday bands we do not have. Pattern: `scripts/scrapers/arnold-rim-trail.ts` plus `scripts/lib/tribe.ts`. Register after GoCalaveras. Do not blocklist GoCalaveras.
2. **The Watering Hole, only after a readable lineup source is confirmed.** Four generic series cards and no band. Home and `/events` are behind Cloudflare (403). A scraper of a page we cannot read would invent the act or write nothing. Confirm a calendar, a Facebook event tab, or a poster with dates before writing code.
3. **Lackler Ceramics workshops, optional.** Booking links for a catalog that already has the class name, the clock, and the price. Wix page: https://www.lacklerceramics.com/workshops.
4. **The Miners Lounge, only if Squarespace grows a dated events collection.** The two line-dancing rows already name Mercedeez. The events page does not.

Do not open scrapers for Ironstone, the fairgrounds, Angels Camp Museum, Marisolio, or Copperopolis Town Square on the evidence above. Copperopolis already has `hwy4-fb-pages`. The others have no dated feed that adds detail over GoCalaveras.

Prospect 772 is the scraper in PR #360, not a follow-up. The open question on that PR is the missing `hwy4_orgs` row for `prospect-772`, which blocks a brand-new insert and does not block a merge onto the two rows already in the table.
