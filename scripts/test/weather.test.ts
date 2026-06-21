import { test } from "node:test";
import assert from "node:assert/strict";
import { isOutdoorEvent } from "../../lib/is-outdoor-event.js";
import {
  mapShortForecast,
  weatherQualifier,
} from "../../lib/weather-conditions.js";
import { getWeatherForDate, type Forecast } from "../../lib/weather.js";

test("maps NWS shortForecast strings into stable condition keys", () => {
  assert.equal(mapShortForecast("Sunny", 0), "clear");
  assert.equal(mapShortForecast("Mostly Sunny", 0), "partly_cloudy");
  assert.equal(mapShortForecast("Partly Cloudy", 0), "partly_cloudy");
  assert.equal(mapShortForecast("Rain Showers Likely", 60), "rain");
  assert.equal(mapShortForecast("Patchy Fog", 0), "fog");
  assert.equal(mapShortForecast("Thunderstorms", 20), "storm");
});

test("outdoor detector is conservative", () => {
  assert.equal(
    isOutdoorEvent({
      name: "Saturday Farmers Market",
      venue_name: "Farmers Market Pavilion and Plaza",
      category: "civic",
    }),
    true
  );
  assert.equal(
    isOutdoorEvent({
      name: "Gallery Talk",
      venue_name: "Jordan Schnitzer Museum of Art",
      category: "fine_arts",
    }),
    false
  );
  assert.equal(
    isOutdoorEvent({
      name: "Summer concert",
      venue_name: "Cuthbert Amphitheater",
      category: "live_music",
    }),
    true
  );
  assert.equal(
    isOutdoorEvent({
      name: "Winter Film Festival",
      venue_name: "Hult Center",
      category: "festival",
    }),
    false
  );
  assert.equal(
    isOutdoorEvent({
      name: "RHYTHM AND RESILIENCE Juneteenth Celebration",
      venue_name: "Downtown Riverfront Park",
      category: "festival",
    }),
    true
  );
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
  // A long event with a big temperature swing → bring layers (range wins).
  assert.equal(
    weatherQualifier({
      temp: 60,
      condition: "clear",
      precipPct: 0,
      range: { low: 60, high: 85 },
    }),
    "bring layers"
  );
  // Mild and unremarkable → no tag at all.
  assert.equal(
    weatherQualifier({ temp: 68, condition: "cloudy", precipPct: 0 }),
    null
  );
});

test("weather horizon returns null when a date is absent from forecast data", () => {
  const forecast: Forecast = {
    byDate: {},
    sunrise: "2026-06-19T05:30:00-07:00",
    sunset: "2026-06-19T20:59:00-07:00",
    fetchedAt: "2026-06-19T12:00:00.000Z",
  };
  assert.equal(getWeatherForDate(forecast, "2099-01-01"), null);
});
