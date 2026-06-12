# briefing-shapes.md — How the daily briefing varies its shape

A daily reader pattern-matches a fixed structure fast ("Tuesday's got a tidy
little arc / Wednesday spreads out / Thursday brings..."). To stay un-bottable,
Millie's briefing rotates among four structural shapes, chosen deterministically
by day of year (`dayOfYear % 4`), and the prompt is handed the last several
openers so it never echoes yesterday's first sentence.

The shapes below are the source of truth for humans; the code the prompt uses is
[lib/briefing-shapes.ts](../lib/briefing-shapes.ts) (`BRIEFING_SHAPES`).

1. **Chronological walk.** Walk the days in order (today, tomorrow, later this
   week). Vary the connecting verbs; don't reuse "brings" / "spreads out" / "has
   a tidy little arc".
2. **One headliner plus the rest.** Lead with the single best event, give it two
   sentences, then sweep everything else into one tight sentence.
3. **Audience cut.** Sort by who it's for, not by day: the kids-day pick, the
   barstool pick, the get-outside pick. Pick the two or three that actually have
   events.
4. **Logistics-first.** Open with the practical heads-up (what needs a
   reservation, what sells out, what's free), then name the events around it.
   ("Two things need a reservation this week; everything else you can wing.")

Enforcement: the briefing route injects the day's shape + the recent openers into
the prompt, and logs a warning if the generated opener's first three words match a
recent briefing (see `openerKey` in lib/briefing-shapes.ts).
