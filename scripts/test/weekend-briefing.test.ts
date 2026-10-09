// The homepage "This Weekend" briefing (issue #370).
//
// It used to be generated only on Friday, always for the Friday seven days
// out, and the footer under either tab showed the daily briefing's date.
// By Thursday the text contradicted the cards (a start time added midweek
// still read as "no start time") while "Updated" claimed it was fresh.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatBriefingUpdated,
  pacificToday,
  shouldArchiveWeekendBriefing,
  thisWeekendRange,
  upcomingWeekendPreview,
} from "../../lib/date-windows.js";
import WeeklyBriefing from "../../components/WeeklyBriefing.js";

function pacificParts(instant: string): { iso: string; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const DOW: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return { iso: `${get("year")}-${get("month")}-${get("day")}`, dow: DOW[get("weekday")] };
}

// The week of the Oct 8 report. Dow is checked against the civil date so a
// swapped fixture fails on its own, not as a mysterious window miss.
const WEEK = [
  { iso: "2026-10-05", dow: 1, friday: "2026-10-09", sunday: "2026-10-11" }, // Mon
  { iso: "2026-10-06", dow: 2, friday: "2026-10-09", sunday: "2026-10-11" }, // Tue
  { iso: "2026-10-07", dow: 3, friday: "2026-10-09", sunday: "2026-10-11" }, // Wed
  { iso: "2026-10-08", dow: 4, friday: "2026-10-09", sunday: "2026-10-11" }, // Thu
  { iso: "2026-10-09", dow: 5, friday: "2026-10-16", sunday: "2026-10-18" }, // Fri
  { iso: "2026-10-10", dow: 6, friday: "2026-10-16", sunday: "2026-10-18" }, // Sat
  { iso: "2026-10-11", dow: 0, friday: "2026-10-16", sunday: "2026-10-18" }, // Sun
] as const;

test("Mon–Thu targets the coming Friday; Fri–Sun targets the Friday seven days later", () => {
  for (const c of WEEK) {
    assert.equal(
      new Date(`${c.iso}T12:00:00Z`).getUTCDay(),
      c.dow,
      `${c.iso} dow fixture`
    );
    const got = upcomingWeekendPreview({ iso: c.iso, dow: c.dow });
    assert.equal(got.friday, c.friday, c.iso);
    assert.equal(got.sunday, c.sunday, c.iso);
  }
});

test("Thursday Oct 8 refreshes the weekend Friday Oct 2 already previewed", () => {
  // The live miss: generated Fri Oct 2 for Oct 9–11, still on screen Thu Oct 8,
  // after Taps for Ta-Ta's gained an 11:00 start on Oct 7.
  const writtenFriday = upcomingWeekendPreview({ iso: "2026-10-02", dow: 5 });
  const refreshThursday = upcomingWeekendPreview({ iso: "2026-10-08", dow: 4 });
  assert.equal(writtenFriday.friday, "2026-10-09");
  assert.equal(refreshThursday.friday, "2026-10-09");
  assert.equal(refreshThursday.sunday, "2026-10-11");
  assert.equal(writtenFriday.label, "Fri, Oct 9 \u2013 Sun, Oct 11");
  assert.equal(refreshThursday.label, writtenFriday.label);
  assert.equal(
    shouldArchiveWeekendBriefing(writtenFriday.label, refreshThursday.label),
    false,
    "a same-weekend refresh must not push a second briefing_history row"
  );

  const nextFriday = upcomingWeekendPreview({ iso: "2026-10-09", dow: 5 });
  assert.equal(nextFriday.label, "Fri, Oct 16 \u2013 Sun, Oct 18");
  assert.equal(
    shouldArchiveWeekendBriefing(refreshThursday.label, nextFriday.label),
    true,
    "the Friday run is the one history row for the new weekend"
  );
});

test("a missing label archives; an identical label does not", () => {
  const label = "Fri, Oct 9 \u2013 Sun, Oct 11";
  assert.equal(shouldArchiveWeekendBriefing(null, label), true);
  assert.equal(shouldArchiveWeekendBriefing(undefined, label), true);
  assert.equal(shouldArchiveWeekendBriefing("", label), true);
  assert.equal(shouldArchiveWeekendBriefing(label, label), false);
});

test("preview agrees with thisWeekendRange on Mon–Thu and looks ahead on Fri–Sun", () => {
  for (const c of WEEK) {
    const today = { iso: c.iso, dow: c.dow };
    const preview = upcomingWeekendPreview(today);
    const live = thisWeekendRange(today);
    if (c.dow >= 1 && c.dow <= 4) {
      assert.equal(preview.friday, live.start, c.iso);
      assert.equal(preview.sunday, live.end, c.iso);
    } else {
      assert.notEqual(preview.friday, live.start, c.iso);
    }
  }
});

test("a Thursday evening Pacific still previews the coming weekend", () => {
  // 11:30pm PDT Thursday is already Friday on a UTC server. The old helper
  // read that clock and jumped a week.
  const today = pacificParts("2026-10-09T06:30:00Z");
  assert.equal(today.iso, "2026-10-08");
  assert.equal(today.dow, 4);
  const preview = upcomingWeekendPreview(today);
  assert.equal(preview.friday, "2026-10-09");
  assert.equal(preview.sunday, "2026-10-11");
});

test("the Updated stamp is the Pacific date of the briefing that is showing", () => {
  // weekend_briefing_date from the Oct 8 report. UTC afternoon is still Oct 2
  // in the corridor, and must not render as the daily's Oct 8.
  assert.equal(formatBriefingUpdated("2026-10-02T14:00:25Z"), "October 2, 2026");
  // Thursday 7am PT refresh (14:00 UTC).
  assert.equal(formatBriefingUpdated("2026-10-08T14:00:00Z"), "October 8, 2026");
  // 11:30pm PDT is still Oct 8, even though UTC has rolled to Oct 9.
  assert.equal(formatBriefingUpdated("2026-10-09T06:30:00Z"), "October 8, 2026");
});

test("cron: one Thursday refresh plus the Friday preview, not a second Opus day", () => {
  const vercel = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8")
  ) as { crons: { path: string; schedule: string }[] };
  const crons = vercel.crons.filter((c) => c.path === "/api/generate-weekend-briefing");
  assert.equal(crons.length, 1, "one cron entry, so the week adds one run");
  // Thursday is the latest morning that still targets the coming weekend
  // (a Wednesday 14:00 UTC run would miss a same-morning edit, as the Oct 7
  // Taps time did). Friday stays, so Fri–Sun still build Next Weekend.
  assert.equal(crons[0].schedule, "0 14 * * 4,5");
});

test("the route reads that window live and archives only a new weekend", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../app/api/generate-weekend-briefing/route.ts", import.meta.url)),
    "utf8"
  );
  assert.match(src, /upcomingWeekendPreview\(/);
  assert.match(src, /shouldArchiveWeekendBriefing\(/);
  assert.match(src, /\.gte\("date", weekend\.friday\)/);
  assert.match(src, /\.lte\("date", weekend\.sunday\)/);
  assert.match(src, /e\.start_time \? `at \$\{e\.start_time\}`/);
  assert.doesNotMatch(src, /getUpcomingWeekend|daysUntilNextFriday/);
});

function walkBriefing(
  node: unknown,
  texts: string[],
  tabLabels: string[]
) {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    const s = String(node);
    if (s.trim()) texts.push(s);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walkBriefing(child, texts, tabLabels);
    return;
  }
  if (typeof node !== "object" || !("props" in node)) return;
  const el = node as {
    type?: unknown;
    props: { children?: unknown; weekendTabLabel?: unknown };
  };
  if (typeof el.props.weekendTabLabel === "string") tabLabels.push(el.props.weekendTabLabel);
  // Render the tab body. The switcher is a client component; calling it needs
  // a dispatcher. Its panel bodies are props, not children.
  if (typeof el.type === "function" && el.type.name === "BriefingContent") {
    walkBriefing(el.type(el.props), texts, tabLabels);
    return;
  }
  const props = el.props as {
    children?: unknown;
    todayContent?: unknown;
    weekendContent?: unknown;
  };
  walkBriefing(props.children, texts, tabLabels);
  walkBriefing(props.todayContent, texts, tabLabels);
  walkBriefing(props.weekendContent, texts, tabLabels);
}

test("the open tab's Updated line is that briefing's own timestamp", () => {
  // The Oct 8 report: daily generated that morning, weekend text still from Oct 2.
  const el = WeeklyBriefing({
    briefing: "Daily copy.",
    generatedAt: "2026-10-08T08:00:00Z",
    weekendBriefing: "Weekend copy. Taps for Ta-Ta's starts at 11:00.",
    weekendGeneratedAt: "2026-10-02T14:00:25Z",
    weekendLabel: "Fri, Oct 9 \u2013 Sun, Oct 11",
  });
  const texts: string[] = [];
  const tabLabels: string[] = [];
  walkBriefing(el, texts, tabLabels);
  const dailyAt = texts.indexOf("Daily copy.");
  const weekendAt = texts.indexOf("Weekend copy. Taps for Ta-Ta's starts at 11:00.");
  assert.ok(dailyAt >= 0 && weekendAt > dailyAt);
  assert.equal(texts[dailyAt + 1], "Updated");
  assert.equal(texts[dailyAt + 2], "October 8, 2026");
  assert.equal(texts[weekendAt + 1], "Updated");
  assert.equal(texts[weekendAt + 2], "October 2, 2026");
  // The weekend stamp is not a copy of the daily one.
  assert.ok(!texts.slice(weekendAt).includes("October 8, 2026"));

  const { dow } = pacificToday();
  const expectedTab = dow === 0 || dow === 5 || dow === 6 ? "Next Weekend" : "This Weekend";
  assert.deepEqual(tabLabels, [expectedTab]);
});
