// Pure forecast logic only — no React / lucide-react imports. The condition →
// icon map lives in lib/weather-icons.ts so scripts/test/weather.test.ts can
// import these functions without pulling a root-only UI dep into the script
// test runner (which resolves against scripts/node_modules). See weather-icons.ts.

export type ConditionKey =
  | "clear"
  | "partly_cloudy"
  | "cloudy"
  | "rain"
  | "snow"
  | "fog"
  | "storm"
  | "windy";

export function mapShortForecast(
  shortText: string,
  precipPct = 0
): ConditionKey {
  const text = shortText.toLowerCase();
  if (/thunder|t-storm|storm/.test(text)) return "storm";
  if (/\b(snow|sleet|ice|freezing)\b/.test(text)) return "snow";
  if (/\b(fog|haze|mist)\b/.test(text)) return "fog";
  if (/\b(wind|breezy|gust)\b/.test(text)) return "windy";
  if (precipPct >= 50 || /\b(rain|shower|drizzle)\b/.test(text)) return "rain";
  if (/\b(partly|mostly sunny|few clouds)\b/.test(text)) return "partly_cloudy";
  if (/\b(overcast|cloudy)\b/.test(text)) return "cloudy";
  return "clear";
}

export function conditionColorClass(
  key: ConditionKey,
  highF: number | null = null
): string {
  if (key === "clear" && highF !== null && highF >= 85) return "text-earth";
  switch (key) {
    case "clear":
    case "partly_cloudy":
    case "snow":
      return "text-sky";
    case "rain":
      return "text-pine";
    case "storm":
      return "text-earth";
    case "cloudy":
    case "fog":
    case "windy":
      return "text-stone";
  }
}

// A long event shows its temp as a range whenever the forecast moves at all.
// The verdict is stricter than the spread: "bring layers" only when the window
// actually cools, or the floor is genuinely cool. A day that warms into the
// 90s is a heat warning, not a jacket.
const LAYERS_SWING_F = 12;
// Morning camp that starts cold and warms (60→85) still earns layers. A 65°
// floor does not: that was the rule that called a 75→95 heat wave "bring layers".
const COOL_LOW_F = 60;
// Pleasant sun. Capped so a foothill heat wave is not sold as a nice patio.
const PATIO_MIN_F = 80;
const PATIO_MAX_F = 89;
// Event-hour temp or the warmest hour in a long window. 90–91° stay unlabeled:
// warm enough that "patio weather" is a lie, short of this warning.
const HEAT_F = 92;

/** Min/max plus the chronological endpoints, when the window was walked in order. */
export interface WeatherRange {
  low: number;
  high: number;
  /** Temp at the first hour of the window. */
  start?: number;
  /** Temp at the last hour of the window. */
  end?: number;
}

function peakTemp(w: {
  temp: number | null;
  range?: WeatherRange | null;
}): number | null {
  const candidates = [w.temp, w.range?.high].filter(
    (t): t is number => typeof t === "number"
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function bringsLayers(range: WeatherRange): boolean {
  if (range.high - range.low < LAYERS_SWING_F) return false;
  // End cooler than start by a real margin: an evening that drops 88→70.
  if (
    typeof range.start === "number" &&
    typeof range.end === "number" &&
    range.start - range.end >= LAYERS_SWING_F
  ) {
    return true;
  }
  // Cool floor, with or without chronology. An unordered min/max is not a
  // cool-down; a warm low (75→95) must not read as layers.
  return range.low <= COOL_LOW_F;
}

/**
 * A short scene-setting tag from the event-HOUR reading. Temp is the forecast
 * temperature at the event's start hour (the range high, for a long window),
 * so the tag matches how it'll feel when you're there, not the day's high or low.
 */
export function weatherQualifier(w: {
  temp: number | null;
  condition: ConditionKey;
  precipPct: number;
  range?: WeatherRange | null;
}): string | null {
  if (w.precipPct >= 50) return "rain likely";
  if (w.precipPct >= 30) return "showers possible";
  // Heat outranks a swing. A day that peaks at 95° is the warning, even when
  // it also climbs out of a cool morning or eases off after the peak.
  const peak = peakTemp(w);
  if (peak !== null && peak >= HEAT_F) return "hot, shade and water";
  if (w.range && bringsLayers(w.range)) return "bring layers";
  if (
    w.temp !== null &&
    w.temp >= PATIO_MIN_F &&
    w.temp <= PATIO_MAX_F &&
    (w.condition === "clear" || w.condition === "partly_cloudy")
  ) {
    return "patio weather";
  }
  if (w.temp !== null && w.temp <= 50) return "bring a layer";
  return null;
}
