/**
 * Canonical 2026 program schedule for Calaveras Big Trees State Park,
 * transcribed from the official State Parks page:
 *   https://www.parks.ca.gov/?page_id=25994   (server-rendered, plain HTML)
 *
 * WHY THIS EXISTS
 * The aggregators (GoCalaveras) re-list these programs with wrong date ranges
 * and flattened times: Creek Critters showed May 30 - Sept 5 when the park runs
 * it June 13 - Aug 15; the astronomy nights all showed one fixed time when each
 * date has its own. The park publishes the truth as recurrence *rules* in prose,
 * which the scrapers can't parse. So we transcribe the rules here and expand them
 * to dated rows with the tested expander in lib/recurrence.ts.
 *
 * This module is PURE (imports only ./recurrence + the ExtractedEvent type), so a
 * creds-free emitter can import it to compute rows. The runnable seed
 * (scripts/seed-bigtrees-programs-2026.ts) and the live loader both build from
 * buildOccurrences(), so they can't diverge.
 *
 * The venue is blocklisted from the auto-scrapers in lib/manual-sources.ts, and a
 * weekly watcher (/api/check-bigtrees-schedule) pings Slack when the source page
 * changes so we re-transcribe and re-run. To change the schedule, edit the
 * PROGRAMS below and re-run the seed; nothing else writes these rows.
 *
 * Modeling notes / judgment calls (the page is prose, sometimes vague):
 *  - South Grove: page says "Fri/Sat/Sun late May through early September, Sundays
 *    also in October." Read as Fri/Sat/Sun May 23 - Sep 7, plus Sundays in Oct.
 *  - Introduction to North Grove: "Sundays starting June 14" with no end; ended at
 *    the Aug 16 close of the daily-program season.
 *  - Laugh then Learn campfire: "topics and time vary," so start_time is null and
 *    the description sends people to the Visitor Center board. Saturdays are
 *    skipped on Night Skies nights, per the page.
 *  - Dropped: the Arnold 4th of July Parade (a town event, not a park program; the
 *    park pauses programs that day) and the undated "July History" pop-ups.
 *  - All programs are free with the $10/vehicle park entrance; the loader marks
 *    them cost_tier 'free' and price-locked so extraction can't relabel them.
 */

import type { ExtractedEvent } from "./extract.js";
import {
  expandWeekly,
  mergeDates,
  excludeDates,
  MON,
  TUE,
  THU,
  FRI,
  SAT,
  SUN,
  EVERY_DAY,
  DAILY_EXCEPT_TUE,
} from "./recurrence.js";

export const VENUE = "Calaveras Big Trees State Park";
export const TOWN = "Arnold";
export const ADDRESS = "1170 East Highway 4, Arnold, CA 95223";
export const SOURCE_NAME = "Calaveras Big Trees State Park";
export const ORG_SLUG = "calaveras-big-trees-state-park";
export const SOURCE_URL = "https://www.parks.ca.gov/?page_id=25994";

// Reused from the venue's existing listings so cards keep their photos.
const IMG = {
  creek: "https://www.gocalaveras.com/wp-content/uploads/2024/08/Calaveras-Big-Trees-Creek-Critters.jpg",
  meadow: "https://www.gocalaveras.com/wp-content/uploads/2016/09/Calaveras-Big-Trees-ben-davidson.jpg",
  bird: "https://www.gocalaveras.com/wp-content/uploads/2016/11/Calaveras-Big-Trees-State-Park-Lisa-Boulton-03.jpg",
  northGrove: "https://www.gocalaveras.com/wp-content/uploads/2017/08/Attractions-Calaveras-Big-Trees-State-Park-Menka-Belgal-03.jpg",
  southGrove: "https://www.gocalaveras.com/wp-content/uploads/2016/09/Calaveras-Big-Trees-State-Park-North-Grove.jpg",
  stump: "https://www.gocalaveras.com/wp-content/uploads/2016/05/Calaveras-Big-Trees-State-Park-the-big-stump-Menka-Belgal-01.jpg",
  astronomy: "https://www.gocalaveras.com/wp-content/uploads/2018/04/Astronomy_-Night_at_Big_Trees_State_Park.jpg",
} as const;

/** ExtractedEvent plus the is_weekly hint the loader applies (so the UI collapses recurring rows). */
export interface SeededEvent extends ExtractedEvent {
  is_weekly: boolean;
}

interface ProgramBase {
  name: string;
  category: string; // live_music | festival | civic | hike_walk | kids | wine | games | other
  start_time: string | null; // HH:MM 24h, or null when the page says it varies
  end_time: string | null;
  description: string;
  image_url: string | null;
  is_weekly: boolean;
}

function occ(base: ProgramBase, date: string, startOverride?: string | null): SeededEvent {
  return {
    name: base.name,
    description: base.description,
    date,
    start_time: startOverride !== undefined ? startOverride : base.start_time,
    end_time: base.end_time,
    venue_name: VENUE,
    town: TOWN,
    address: ADDRESS,
    category: base.category,
    price: null,
    artists: null,
    event_url: null,
    image_url: base.image_url,
    source_event_id: null,
    is_weekly: base.is_weekly,
  };
}

/** A recurring program: one ProgramBase expanded across a precomputed date list. */
function recurring(base: ProgramBase, dates: readonly string[]): SeededEvent[] {
  return dates.map((d) => occ(base, d));
}

/** A program given as explicit (date, start_time) pairs, e.g. astronomy nights. */
function onDates(
  base: ProgramBase,
  entries: ReadonlyArray<{ date: string; start: string | null }>
): SeededEvent[] {
  return entries.map((e) => occ(base, e.date, e.start));
}

// Saturdays that have a Night Skies program — Saturday campfires are skipped then.
const NIGHT_SKIES_SATURDAYS = ["2026-06-13", "2026-08-01", "2026-08-08"];

/**
 * The full season. Order here is the order rows are emitted; it has no effect on
 * the site (events sort by date), but grouping by program keeps this readable.
 */
export function buildOccurrences(): SeededEvent[] {
  const out: SeededEvent[] = [];

  // ---- Kid's programs --------------------------------------------------------
  out.push(
    ...recurring(
      {
        name: "Creek Critters @ Big Trees State Park",
        category: "kids",
        start_time: "13:00",
        end_time: "14:00",
        image_url: IMG.creek,
        // ~2x/week (Tue+Sat) — low enough to show inline rather than hide behind
        // the weekly toggle. The high-frequency daily programs stay is_weekly.
        is_weekly: false,
        description:
          "A hands-on favorite for all ages. Wade into Beaver Creek with a park interpreter to net and identify the critters living in the water, and learn what they say about the health of the watershed. Meet at Beaver Creek, a short walk from the Beaver Creek Picnic Area, and come with sandals. Free with the $10/vehicle park entrance.",
      },
      expandWeekly([TUE, SAT], "2026-06-13", "2026-08-15")
    )
  );

  out.push(
    ...recurring(
      {
        name: "Junior Rangers @ Big Trees State Park",
        category: "kids",
        start_time: "10:00",
        end_time: null,
        image_url: IMG.northGrove,
        is_weekly: true,
        description:
          "Drop-in programs for kids: Little Rangers (ages 3 to 6) and Junior Rangers (ages 7 to 12) earn wooden badges and work through their logbooks with a park interpreter. Meet at the picnic tables across from Jack Knight Hall. Free with the $10/vehicle park entrance.",
      },
      mergeDates(
        expandWeekly([SAT, SUN], "2026-05-23", "2026-06-14"),
        expandWeekly(DAILY_EXCEPT_TUE, "2026-06-15", "2026-08-16")
      )
    )
  );

  // ---- Guided hikes & walks --------------------------------------------------
  out.push(
    ...recurring(
      {
        name: "North Grove Guided Walk @ Big Trees State Park",
        category: "hike_walk",
        start_time: "11:30",
        end_time: "13:00",
        image_url: IMG.northGrove,
        is_weekly: true,
        description:
          "A relaxed, interpreter-led loop through the giant sequoias of the North Grove, about 1.7 level miles. Meet at the trailhead by the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      mergeDates(
        expandWeekly([SAT, SUN], "2026-05-23", "2026-06-14"),
        expandWeekly(EVERY_DAY, "2026-06-15", "2026-08-16")
      )
    )
  );

  out.push(
    ...recurring(
      {
        name: "South Grove Guided Hike @ Big Trees State Park",
        category: "hike_walk",
        start_time: "10:00",
        end_time: "13:00",
        image_url: IMG.southGrove,
        is_weekly: true,
        description:
          "A moderate five-mile hike to the park's larger, quieter grove of giant sequoias. Bring water and a snack or lunch; there is no food or water at the trailhead. Meet at the South Grove trailhead parking lot. Free with the $10/vehicle park entrance.",
      },
      mergeDates(
        expandWeekly([FRI, SAT, SUN], "2026-05-23", "2026-09-07"),
        expandWeekly([SUN], "2026-10-01", "2026-10-31")
      )
    )
  );

  out.push(
    ...recurring(
      {
        name: "Introduction to North Grove @ Big Trees State Park",
        category: "hike_walk",
        start_time: "13:00",
        end_time: "13:45",
        image_url: IMG.stump,
        // Sundays only (~1x/week) — shown inline, not behind the weekly toggle.
        is_weekly: false,
        description:
          "Short on time? A brief, half-mile introduction to the giant sequoias with a park interpreter. Meet outside the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      expandWeekly([SUN], "2026-06-14", "2026-08-16")
    )
  );

  out.push(
    ...recurring(
      {
        name: "Bird Walk @ Big Trees State Park",
        category: "hike_walk",
        start_time: "09:30",
        end_time: "11:30",
        image_url: IMG.bird,
        // Thursdays (~1x/week) — shown inline.
        is_weekly: false,
        description:
          "A level, roughly one-mile morning walk around the North Grove, campground, and meadow, looking and listening for birds. No experience or gear required. Meet outside the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      expandWeekly([THU], "2026-05-28", "2026-09-24")
    )
  );

  out.push(
    ...recurring(
      {
        name: "Meadow Walk @ Big Trees State Park",
        category: "hike_walk",
        start_time: "10:00",
        end_time: "11:00",
        image_url: IMG.meadow,
        // Tue+Sat, same cadence as Creek Critters — shown inline.
        is_weekly: false,
        description:
          "An easy half-mile stroll through the North Grove meadow with a park interpreter, looking at the plants and wildlife that live there. Meet at North Grove Campsite #16, by the black sandwich board. Free with the $10/vehicle park entrance.",
      },
      expandWeekly([TUE, SAT], "2026-06-16", "2026-08-15")
    )
  );

  // ---- Campfire programs -----------------------------------------------------
  out.push(
    ...recurring(
      {
        name: "Campfire: Songs and Silliness @ Big Trees State Park",
        category: "civic",
        start_time: "19:30",
        end_time: null,
        image_url: IMG.northGrove,
        is_weekly: true,
        description:
          "A Friday-night campfire of songs and silliness with park staff and volunteers. Meet at the Campfire Center by the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      expandWeekly([FRI], "2026-06-15", "2026-08-16")
    )
  );

  out.push(
    ...recurring(
      {
        name: "Campfire: Hug-A-Tree @ Big Trees State Park",
        category: "civic",
        start_time: "20:00",
        end_time: null,
        image_url: IMG.northGrove,
        is_weekly: true,
        description:
          "A Monday-night campfire built around Hug-a-Tree, the kid-friendly lesson on what to do if you ever get lost in the woods. Meet at the Campfire Center by the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      expandWeekly([MON], "2026-06-15", "2026-08-16")
    )
  );

  out.push(
    ...recurring(
      {
        name: "Campfire: Laugh then Learn @ Big Trees State Park",
        category: "civic",
        start_time: null, // page: "topics and time varies"
        end_time: null,
        image_url: IMG.northGrove,
        is_weekly: true,
        description:
          "A weekend-evening campfire program. Topics and start time vary, so check the black sandwich board by the Visitor Center. Saturday campfires are skipped on Night Skies nights. Meet at the Campfire Center by the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      excludeDates(
        mergeDates(
          expandWeekly([SAT], "2026-05-23", "2026-08-16"),
          expandWeekly([SUN], "2026-06-15", "2026-08-16")
        ),
        NIGHT_SKIES_SATURDAYS
      )
    )
  );

  // ---- Evening astronomy (explicit dates, per-night times; 2026 only) --------
  out.push(
    ...onDates(
      {
        name: "Optical Astronomy Nights @ Big Trees State Park",
        category: "other",
        start_time: null,
        end_time: null,
        image_url: IMG.astronomy,
        is_weekly: false,
        description:
          "Telescope viewing with park astronomers. Start times shift with sunset and the moon. Meet at the Scenic Overlook, a few minutes down the Parkway road from the entrance station. Parking is limited, so carpool, and bring chairs and blankets. Free with the $10/vehicle park entrance.",
      },
      [
        { date: "2026-05-14", start: "20:30" },
        { date: "2026-05-21", start: "20:00" },
        { date: "2026-06-11", start: "20:30" },
        { date: "2026-06-25", start: "21:00" },
        { date: "2026-07-09", start: "20:30" },
        { date: "2026-07-23", start: "20:30" },
        { date: "2026-08-13", start: "20:00" },
        { date: "2026-08-20", start: "19:30" },
        { date: "2026-09-10", start: "19:30" },
      ]
    )
  );

  out.push(
    ...onDates(
      {
        name: "Night Skies with Doc Nancy @ Big Trees State Park",
        category: "other",
        start_time: null,
        end_time: null,
        image_url: IMG.astronomy,
        is_weekly: false,
        description:
          "Doc Nancy shares the science, constellations, and stories of the night sky. Meet at the Scenic Overlook. Parking is limited, so carpool, and bring chairs and blankets. Free with the $10/vehicle park entrance.",
      },
      [
        { date: "2026-06-13", start: "21:00" },
        { date: "2026-07-03", start: "20:30" },
        { date: "2026-07-10", start: "20:30" },
        { date: "2026-08-01", start: "20:00" },
        { date: "2026-08-08", start: "20:00" },
        { date: "2026-09-05", start: "20:00" },
      ]
    )
  );

  // ---- Dated special events --------------------------------------------------
  out.push(
    occ(
      {
        name: "Walk Through the Lens of History @ Big Trees State Park",
        category: "hike_walk",
        start_time: "13:00",
        end_time: "15:00",
        image_url: IMG.northGrove,
        is_weekly: false,
        description:
          "A State Parks Week walk along the 1.7-mile North Grove loop, told through the history of the area alongside the giant sequoias. Meet at the entrance of the North Grove trail by the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      "2026-06-10"
    ),
    occ(
      {
        name: "Explore Nature Journaling @ Big Trees State Park",
        category: "other",
        start_time: "11:00",
        end_time: "12:00",
        image_url: IMG.stump,
        is_weekly: false,
        description:
          "A State Parks Week introduction to nature journaling. Participants take home their own journal. Meet at the picnic tables behind the Ranger and Natural Resources Office. Free with the $10/vehicle park entrance.",
      },
      "2026-06-11"
    ),
    occ(
      {
        name: "Fire and the Forest @ Big Trees State Park",
        category: "hike_walk",
        start_time: "11:30",
        end_time: "13:30",
        image_url: IMG.northGrove,
        is_weekly: false,
        description:
          "A State Parks Week walk on the level 1.7-mile North Grove trail about how recent prescribed burns protect the giant sequoias, the germination they spark, and the role of fire in this forest. Meet at the North Grove trailhead by the Visitor Center. Free with the $10/vehicle park entrance.",
      },
      "2026-06-12"
    ),
    occ(
      {
        name: "Kid's Career Fair @ Big Trees State Park",
        category: "kids",
        start_time: "11:30",
        end_time: "13:30",
        image_url: IMG.creek,
        is_weekly: false,
        description:
          "Hands-on stations where kids meet the people who work in state parks and with park partners, with a prize for visiting every station. Counts toward Little and Junior Ranger badges. Find it on the paved path between the Visitor Center parking lot and Jack Knight Hall. Free with the $10/vehicle park entrance.",
      },
      "2026-06-13"
    ),
    occ(
      {
        name: "STEAM at the Park @ Big Trees State Park",
        category: "kids",
        start_time: "11:30",
        end_time: "13:30",
        image_url: IMG.creek,
        is_weekly: false,
        description:
          "Science, Technology, Engineering, Art, and Math stations across the park, each with a hands-on activity and a prize for visiting them all. Counts toward Little and Junior Ranger badges. Find it at the start of the North Grove trail between the Visitor Center and the Stump. Free with the $10/vehicle park entrance.",
      },
      "2026-08-01"
    ),
    occ(
      {
        name: "Celebrate Teachers @ Big Trees State Park",
        category: "civic",
        start_time: "11:30",
        end_time: "13:30",
        image_url: IMG.stump,
        is_weekly: false,
        description:
          "An information session for teachers on field-trip opportunities across Calaveras, Tuolumne, and Amador counties, including free and grant-funded options. Meet at Jack Knight Hall. Free with the $10/vehicle park entrance.",
      },
      "2026-08-08"
    )
  );

  return out;
}
