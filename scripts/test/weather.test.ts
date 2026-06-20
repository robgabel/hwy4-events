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
  assert.equal(
    weatherQualifier(
      { highF: 82, lowF: 55, condition: "clear", precipPct: 0 },
      { start_time: "18:00:00" }
    ),
    "patio weather"
  );
  assert.equal(
    weatherQualifier(
      { highF: 62, lowF: 46, condition: "cloudy", precipPct: 0 },
      { start_time: "19:30:00" }
    ),
    "chilly evening"
  );
  assert.equal(
    weatherQualifier(
      { highF: 62, lowF: 52, condition: "rain", precipPct: 55 },
      { start_time: "12:00:00" }
    ),
    "rain likely"
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
