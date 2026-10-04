import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapShortForecast,
  weatherQualifier,
} from "../../lib/weather-conditions.js";
import {
  getWeatherForDate,
  resolveEventWeather,
  type Forecast,
} from "../../lib/weather.js";
import { pacificToday } from "../../lib/date-windows.js";

test("maps NWS shortForecast strings into stable condition keys", () => {
  assert.equal(mapShortForecast("Sunny", 0), "clear");
  assert.equal(mapShortForecast("Mostly Sunny", 0), "partly_cloudy");
  assert.equal(mapShortForecast("Partly Cloudy", 0), "partly_cloudy");
  assert.equal(mapShortForecast("Rain Showers Likely", 60), "rain");
  assert.equal(mapShortForecast("Patchy Fog", 0), "fog");
  assert.equal(mapShortForecast("Thunderstorms", 20), "storm");
});

test("weather qualifier stays plain and conservative", () => {
  // Reads the event-HOUR temperature (not the day's high/low), so the tags
  // reflect how it'll feel when you're there. Logic lives in weatherQualifier.
  // Hot + clear → patio weather.
  assert.equal(
    weatherQualifier({ temp: 82, condition: "clear", precipPct: 0 }),
    "patio weather"
  );
  // Cool at the event hour → bring a layer.
  assert.equal(
    weatherQualifier({ temp: 48, condition: "cloudy", precipPct: 0 }),
    "bring a layer"
  );
  // Likely rain wins over temperature.
  assert.equal(
    weatherQualifier({ temp: 62, condition: "rain", precipPct: 55 }),
    "rain likely"
  );
  // A real chance of showers (>= 30%, < 50%).
  assert.equal(
    weatherQualifier({ temp: 66, condition: "clear", precipPct: 35 }),
    "showers possible"
  );
  // A long window whose floor is genuinely cool (≤60) → bring layers, even
  // when the day warms. The cool floor is the signal, not the unordered spread.
  assert.equal(
    weatherQualifier({
      temp: 85,
      condition: "clear",
      precipPct: 0,
      range: { low: 60, high: 85, start: 60, end: 85 },
    }),
    "bring layers"
  );
  // A long event with a modest swing still renders as a range, but the spread
  // isn't big enough to earn the "bring layers" verdict — no tag.
  assert.equal(
    weatherQualifier({
      temp: 64,
      condition: "clear",
      precipPct: 0,
      range: { low: 53, high: 64 },
    }),
    null
  );
  // Mild and unremarkable → no tag at all.
  assert.equal(
    weatherQualifier({ temp: 68, condition: "cloudy", precipPct: 0 }),
    null
  );
});

test("heat-wave readings are a warning, not patio weather or layers", () => {
  // Daytime outdoor event that warms through the afternoon and peaks at 95+.
  // Acceptance: never "bring layers". The min/max-only shape is what the chip
  // used to receive, before start/end existed.
  assert.equal(
    weatherQualifier({
      temp: 95,
      condition: "clear",
      precipPct: 0,
      range: { low: 75, high: 95 },
    }),
    "hot, shade and water"
  );
  assert.equal(
    weatherQualifier({
      temp: 95,
      condition: "clear",
      precipPct: 0,
      range: { low: 75, high: 95, start: 75, end: 95 },
    }),
    "hot, shade and water"
  );
  // Same window if the point temp is still the cool start hour.
  assert.equal(
    weatherQualifier({
      temp: 75,
      condition: "clear",
      precipPct: 0,
      range: { low: 75, high: 95, start: 75, end: 95 },
    }),
    "hot, shade and water"
  );
  // 94° clear, and a 1 PM point reading at 95°, never "patio weather".
  assert.equal(
    weatherQualifier({ temp: 94, condition: "clear", precipPct: 0 }),
    "hot, shade and water"
  );
  assert.equal(
    weatherQualifier({ temp: 95, condition: "clear", precipPct: 0 }),
    "hot, shade and water"
  );
  // The heat line is 92. 90–91 stay unlabeled: not pleasant, not a heat warning.
  assert.equal(
    weatherQualifier({ temp: 92, condition: "clear", precipPct: 0 }),
    "hot, shade and water"
  );
  assert.equal(
    weatherQualifier({ temp: 90, condition: "clear", precipPct: 0 }),
    null
  );
  assert.equal(
    weatherQualifier({ temp: 89, condition: "partly_cloudy", precipPct: 0 }),
    "patio weather"
  );
  // 85° clear stays patio weather. The pleasant band is 80–89.
  assert.equal(
    weatherQualifier({ temp: 85, condition: "clear", precipPct: 0 }),
    "patio weather"
  );
  // Evening that cools 88→70 still earns layers. The drop is the verdict.
  assert.equal(
    weatherQualifier({
      temp: 88,
      condition: "clear",
      precipPct: 0,
      range: { low: 70, high: 88, start: 88, end: 70 },
    }),
    "bring layers"
  );
  // A warming swing with a mild floor is not layers. 65° does not need a jacket.
  assert.equal(
    weatherQualifier({
      temp: 80,
      condition: "clear",
      precipPct: 0,
      range: { low: 65, high: 80, start: 65, end: 80 },
    }),
    "patio weather"
  );
  // Point reading at 48° is unchanged.
  assert.equal(
    weatherQualifier({ temp: 48, condition: "clear", precipPct: 0 }),
    "bring a layer"
  );
  // Rain still outranks the heat warning.
  assert.equal(
    weatherQualifier({ temp: 95, condition: "rain", precipPct: 55 }),
    "rain likely"
  );
});

test("a long window records start and end in hour order", () => {
  const date = pacificToday().iso;
  const warming = resolveEventWeather(
    forecastAt(date, { 10: 75, 11: 82, 12: 88, 13: 95, 14: 94, 15: 90, 16: 86 }),
    { date, start_time: "10:00", end_time: "16:00" }
  );
  assert.ok(warming?.range);
  assert.equal(warming.range.start, 75);
  assert.equal(warming.range.end, 86);
  assert.equal(warming.range.low, 75);
  assert.equal(warming.range.high, 95);
  assert.equal(weatherQualifier(warming), "hot, shade and water");

  const cooling = resolveEventWeather(
    forecastAt(date, { 17: 88, 18: 84, 19: 80, 20: 76, 21: 72, 22: 70 }),
    { date, start_time: "17:00", end_time: "22:00" }
  );
  assert.ok(cooling?.range);
  assert.equal(cooling.range.start, 88);
  assert.equal(cooling.range.end, 70);
  assert.equal(weatherQualifier(cooling), "bring layers");
});

function forecastAt(date: string, hours: Record<number, number>): Forecast {
  const byHour: Forecast["byHour"] = {};
  for (const [hour, temp] of Object.entries(hours)) {
    byHour[`${date}T${hour.padStart(2, "0")}`] = {
      temp,
      condition: "clear",
      precipPct: 0,
      shortText: "Sunny",
    };
  }
  return {
    byHour,
    byDate: {},
    sunrise: `${date}T06:00:00-07:00`,
    sunset: `${date}T19:00:00-07:00`,
    fetchedAt: `${date}T12:00:00.000Z`,
  };
}

test("weather horizon returns null when a date is absent from forecast data", () => {
  const forecast: Forecast = {
    byHour: {},
    byDate: {},
    sunrise: "2026-06-19T05:30:00-07:00",
    sunset: "2026-06-19T20:59:00-07:00",
    fetchedAt: "2026-06-19T12:00:00.000Z",
  };
  assert.equal(getWeatherForDate(forecast, "2099-01-01"), null);
});
