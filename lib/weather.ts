import { WEATHER_USER_AGENT } from "./constants";
import { CORRIDOR_TOWNS } from "./towns";
import { addDays, pacificToday } from "./date-windows";
import { mapShortForecast, type ConditionKey } from "./weather-conditions";

const PACIFIC_TZ = "America/Los_Angeles";
const POINTS_REVALIDATE_SECONDS = 86_400;
const FORECAST_REVALIDATE_SECONDS = 3_600;
const WEATHER_TIMEOUT_MS = 5_000;

export type { ConditionKey };

export interface DayWeather {
  date: string;
  highF: number | null;
  lowF: number | null;
  condition: ConditionKey;
  precipPct: number;
  shortText: string;
  isWithinHorizon: true;
}

export interface Forecast {
  byDate: Record<string, DayWeather>;
  sunrise: string;
  sunset: string;
  fetchedAt: string;
}

interface NwsPointsResponse {
  properties?: {
    forecast?: string;
  };
}

interface NwsPeriod {
  name?: string;
  isDaytime?: boolean;
  temperature?: number | null;
  shortForecast?: string;
  probabilityOfPrecipitation?: {
    value?: number | null;
  } | null;
  startTime?: string;
}

interface NwsForecastResponse {
  properties?: {
    periods?: NwsPeriod[];
  };
}

type DraftDay = {
  date: string;
  highF: number | null;
  lowF: number | null;
  dayText: string | null;
  nightText: string | null;
  precipPct: number;
};

async function fetchJson<T>(
  url: string,
  revalidate: number
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  const init = {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": WEATHER_USER_AGENT,
    },
    next: { revalidate },
    signal: controller.signal,
  } as RequestInit & { next: { revalidate: number } };

  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      console.warn(`[weather] ${url} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn("[weather] fetch failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pacificDateKey(dateTime: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(dateTime));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function clampPrecip(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function foldPeriods(periods: NwsPeriod[]): Record<string, DayWeather> {
  const drafts = new Map<string, DraftDay>();

  for (const period of periods) {
    if (!period.startTime) continue;
    const date = pacificDateKey(period.startTime);
    const draft =
      drafts.get(date) ??
      ({
        date,
        highF: null,
        lowF: null,
        dayText: null,
        nightText: null,
        precipPct: 0,
      } satisfies DraftDay);

    const temp =
      typeof period.temperature === "number" ? period.temperature : null;
    if (period.isDaytime) {
      if (temp !== null) draft.highF = Math.max(draft.highF ?? temp, temp);
      draft.dayText ||= period.shortForecast || null;
    } else {
      if (temp !== null) draft.lowF = Math.min(draft.lowF ?? temp, temp);
      draft.nightText ||= period.shortForecast || null;
    }

    draft.precipPct = Math.max(
      draft.precipPct,
      clampPrecip(period.probabilityOfPrecipitation?.value)
    );
    drafts.set(date, draft);
  }

  const today = pacificToday().iso;
  const horizonEnd = addDays(today, 7);
  const byDate: Record<string, DayWeather> = {};
  for (const draft of drafts.values()) {
    if (draft.date < today || draft.date > horizonEnd) continue;
    const shortText = draft.dayText ?? draft.nightText ?? "Forecast unavailable";
    byDate[draft.date] = {
      date: draft.date,
      highF: draft.highF,
      lowF: draft.lowF,
      condition: mapShortForecast(shortText, draft.precipPct),
      precipPct: draft.precipPct,
      shortText,
      isWithinHorizon: true,
    };
  }
  return byDate;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

function timezoneOffsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function offsetSuffix(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function localIsoAtMinutes(date: string, minutesFromMidnight: number): string {
  const rounded = Math.round(minutesFromMidnight);
  const minutes = ((rounded % 1440) + 1440) % 1440;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const offset = timezoneOffsetMinutes(
    PACIFIC_TZ,
    new Date(`${date}T12:00:00Z`)
  );
  return `${date}T${String(hours).padStart(2, "0")}:${String(mins).padStart(
    2,
    "0"
  )}:00${offsetSuffix(offset)}`;
}

function solarTimes(
  date: string,
  lat: number,
  lng: number
): { sunrise: string; sunset: string } {
  const noon = new Date(`${date}T12:00:00Z`);
  const n = dayOfYear(noon);
  const gamma = (2 * Math.PI * (n - 1)) / 365;
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const latRad = (lat * Math.PI) / 180;
  const zenith = (90.833 * Math.PI) / 180;
  const hourAngle =
    (Math.acos(
      (Math.cos(zenith) / (Math.cos(latRad) * Math.cos(decl))) -
        Math.tan(latRad) * Math.tan(decl)
    ) *
      180) /
    Math.PI;
  const solarNoonUtc = 720 - 4 * lng - eqTime;
  const offset = timezoneOffsetMinutes(PACIFIC_TZ, noon);
  const sunriseLocal = solarNoonUtc - 4 * hourAngle + offset;
  const sunsetLocal = solarNoonUtc + 4 * hourAngle + offset;
  return {
    sunrise: localIsoAtMinutes(date, sunriseLocal),
    sunset: localIsoAtMinutes(date, sunsetLocal),
  };
}

export async function getForecast(
  lat: number,
  lng: number
): Promise<Forecast | null> {
  const pointsUrl = `https://api.weather.gov/points/${lat},${lng}`;
  const points = await fetchJson<NwsPointsResponse>(
    pointsUrl,
    POINTS_REVALIDATE_SECONDS
  );
  const forecastUrl = points?.properties?.forecast;
  if (!forecastUrl) return null;

  const forecast = await fetchJson<NwsForecastResponse>(
    forecastUrl,
    FORECAST_REVALIDATE_SECONDS
  );
  const periods = forecast?.properties?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;

  const today = pacificToday().iso;
  return {
    byDate: foldPeriods(periods),
    ...solarTimes(today, lat, lng),
    fetchedAt: new Date().toISOString(),
  };
}

export function getWeatherForDate(
  forecast: Forecast | null,
  date: string
): DayWeather | null {
  if (!forecast) return null;
  const today = pacificToday().iso;
  if (date < today || date > addDays(today, 7)) return null;
  return forecast.byDate[date] ?? null;
}

/** Forecasts keyed by corridor town name (lib/towns.ts). */
export type TownForecasts = Record<string, Forecast | null>;

/**
 * Per-town forecast for the whole corridor. Weather here varies enormously by
 * elevation: Copperopolis (~850 ft) to Bear Valley (~7,000 ft) are ~60 miles
 * and 6,000 vertical feet apart, so a single corridor-centroid forecast is
 * wrong at both ends. Each town gets its own NWS lookup from its lib/towns.ts
 * lat/lng. Fetches run in parallel and are individually cached (see
 * getForecast); one town failing yields null for that town only, not the map.
 */
export async function getForecastsByTown(): Promise<TownForecasts> {
  const entries = await Promise.all(
    CORRIDOR_TOWNS.map(
      async (town) =>
        [town.name, await getForecast(town.lat, town.lng)] as const
    )
  );
  return Object.fromEntries(entries);
}
