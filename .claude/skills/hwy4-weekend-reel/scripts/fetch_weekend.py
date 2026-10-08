#!/usr/bin/env python3
"""Pull Friday-Sunday events from hwy4events.com's public listing.

Reads the schema.org Event JSON-LD on the date-scoped weekend page
(/this-weekend?from=<fri>&to=<sun>, the same data readers see after the site's
quality filters), plus the weather line shown on each card.

That ItemList carries the full public count in numberOfItems but caps its event
list (100 on that page; the homepage caps at 50 counted from today, which is why
this no longer reads the homepage). If the list was cut short, the script stops
with an error instead of writing an undercounted events.json.

Usage:
  python fetch_weekend.py [--friday YYYY-MM-DD] [--out PATH]

Default weekend = the next Friday strictly after today's PACIFIC date. A UTC
machine on a Thursday evening is already on Friday, and would otherwise pick next
weekend.
Default output = <week folder>/events.json (see paths.py).
"""
import argparse, datetime as dt, html, json, re, sys, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import week_dir

URL = "https://hwy4events.com"
PACIFIC = "America/Los_Angeles"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (hwy4-weekend-reel skill)"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def pacific_now():
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo(PACIFIC))
    except Exception as e:  # no tz database on this machine
        sys.exit(f"Can't read the Pacific date ({type(e).__name__}: {e}). Pass --friday YYYY-MM-DD.")


def next_friday(today):
    return today + dt.timedelta(days=((4 - today.weekday()) % 7) or 7)


def weekend_url(fri, sun):
    return f"{URL}/this-weekend?from={fri.isoformat()}&to={sun.isoformat()}"


def walk(o, kind="Event"):
    if isinstance(o, dict):
        if o.get("@type") == kind:
            yield o
        for v in o.values():
            yield from walk(v, kind)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v, kind)


def json_ld_blocks(page):
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        try:
            yield json.loads(m.group(1))
        except Exception:
            continue


def truncated_lists(page):
    """(numberOfItems, items carried) for every ItemList whose event list was cut short."""
    cut = []
    for data in json_ld_blocks(page):
        for il in walk(data, "ItemList"):
            total, carried = il.get("numberOfItems"), len(il.get("itemListElement") or [])
            if isinstance(total, int) and total > carried:
                cut.append((total, carried))
    return cut


def time_label(iso):
    if not iso or "T" not in iso:
        return None
    t = dt.datetime.fromisoformat(iso[:19])
    return t.strftime("%-I:%M %p").replace(":00 ", " ")


def card_text_lines(page):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    return [l.strip() for l in t.split("\n") if l.strip()]


def weather_for(lines, name, names, occurrence=0):
    """Temp ('72' or '72→89') and optional note ('bring layers') from the Nth card with this name."""
    hits = [i for i, l in enumerate(lines) if l == name]
    # each card repeats its title; group hits that sit close together into one card
    cards = [h for k, h in enumerate(hits) if k == 0 or h - hits[k - 1] > 6]
    for i in cards[occurrence:occurrence + 1]:
        temp = note = None
        for j in range(i + 1, min(i + 40, len(lines))):
            if j > i + 3 and lines[j] in names and lines[j] != name:
                break
            if temp is None and re.fullmatch(r"\d{2,3}(→\d{2,3})?", lines[j]) and j + 1 < len(lines) and lines[j + 1] == "°":
                temp = lines[j] + "°"
                if j + 3 < len(lines) and lines[j + 2] == "·" and len(lines[j + 3]) < 30:
                    note = lines[j + 3]
                break
        if temp:
            return temp, note
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--friday", help="YYYY-MM-DD of the Friday to cover")
    ap.add_argument("--out", help="default: <week folder>/events.json")
    a = ap.parse_args()
    fri = dt.date.fromisoformat(a.friday) if a.friday else next_friday(pacific_now().date())
    days = [fri + dt.timedelta(days=k) for k in range(3)]
    a.out = a.out or str(week_dir(fri.isoformat()) / "events.json")
    want = {d.isoformat() for d in days}

    source = weekend_url(days[0], days[-1])
    page = fetch(source)
    cut = truncated_lists(page)
    if cut:
        total, carried = cut[0]
        sys.exit(f"The weekend page lists {total} events but its structured data carries only {carried}, "
                 "so events.json would undercount. Use the Supabase fallback in SKILL.md step 1.")
    events, seen = [], set()
    for data in json_ld_blocks(page):
        for e in walk(data):
            sd = e.get("startDate", "")
            key = (e.get("name"), sd)
            if sd[:10] not in want or key in seen:
                continue
            seen.add(key)
            loc = e.get("location") or {}
            offers = e.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            events.append({
                "date": sd[:10],
                "day": dt.date.fromisoformat(sd[:10]).strftime("%A"),
                "start": sd, "end": e.get("endDate"),
                "time": time_label(sd),
                "name": html.unescape(e.get("name", "")),
                "venue": loc.get("name"),
                "town": (loc.get("address") or {}).get("addressLocality"),
                "price": offers.get("price"),
                "performers": [p.get("name") for p in (e.get("performer") or []) if isinstance(p, dict)],
                "description": html.unescape(e.get("description") or "")[:600],
            })

    lines = card_text_lines(page)
    names = {e["name"] for e in events}
    events.sort(key=lambda e: e["start"])
    nth = {}
    for e in events:
        k = nth.get(e["name"], 0); nth[e["name"]] = k + 1
        e["weather"], e["weather_note"] = weather_for(lines, e["name"], names, k)

    out = {
        "friday": fri.isoformat(),
        "dates": sorted(want),
        "count": len(events),
        "source": source,
        "fetched_at": pacific_now().isoformat(timespec="minutes"),
        "events": events,
    }
    with open(a.out, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"{len(events)} listings for {fri:%a %b %-d}-{days[-1]:%a %b %-d} -> {a.out}")
    for e in events:
        print(f"  {e['day'][:3]} {e['time'] or 'all day':>8}  {e['name']}  ({e['venue']}, {e['town']})  {e['weather'] or ''} {e['weather_note'] or ''}")
    if not events:
        sys.exit("No events found on the weekend page; try the Supabase fallback in SKILL.md step 1.")


if __name__ == "__main__":
    main()
