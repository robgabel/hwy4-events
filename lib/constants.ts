// Site identity constants, sourced from the active region's config
// (regions/<slug>/core.ts — see docs/REGIONS.md). Values are byte-identical
// to the pre-extraction literals; NEXT_PUBLIC_SITE_URL still wins over the
// region default so per-deployment overrides keep working.

import { REGION } from "./region";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || REGION.defaultSiteUrl;

// NWS (api.weather.gov) requires a descriptive User-Agent that names the app
// and a contact (a URL suffices). Weather is fetched PER TOWN (lib/weather.ts
// getForecastsByTown) from each town's lat/lng in lib/towns.ts, because
// elevation along the 4 swings ~6,000 ft and a single point is wrong at both
// ends. The bot name comes from region config, so porting bumps it for free.
export const WEATHER_USER_AGENT = `${REGION.botName}/1.0 (${SITE_URL})`;

export const SITE_NAME = REGION.siteName;
export const SITE_DESCRIPTION = REGION.siteDescription;
export const SITE_OG_DESCRIPTION = REGION.siteOgDescription;
