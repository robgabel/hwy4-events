export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://hwy4events.com";

// NWS (api.weather.gov) requires a descriptive User-Agent that names the app
// and a contact (a URL suffices). Weather is fetched PER TOWN (lib/weather.ts
// getForecastsByTown) from each town's lat/lng in lib/towns.ts, because
// elevation along the 4 swings ~6,000 ft and a single point is wrong at both
// ends. Bump the name when porting to a new region.
export const WEATHER_USER_AGENT = `Hwy4EventsBot/1.0 (${SITE_URL})`;

export const SITE_NAME = "Hwy 4 Events";
export const SITE_DESCRIPTION =
  "Today's events and this week's lineup along the Highway 4 corridor — live music, festivals, and community happenings from Angels Camp to Bear Valley, updated daily with an opinionated briefing.";
export const SITE_OG_DESCRIPTION =
  "What's happening today on the 4? Daily briefing + event listings from Angels Camp to Bear Valley.";
