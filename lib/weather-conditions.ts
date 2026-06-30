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

// A long event shows its temp as a range whenever the forecast moves at all,
// but "bring layers" is only worth saying when the swing is genuinely big —
// otherwise the numeric spread speaks for itself.
const LAYERS_SWING_F = 12;

/**
 * A short scene-setting tag from the event-HOUR reading. Temp is the forecast
 * temperature at the event's start hour, so "patio weather" / "bring a layer"
 * reflect how it'll actually feel when you're there, not the day's high or low.
 */
export function weatherQualifier(w: {
  temp: number | null;
  condition: ConditionKey;
  precipPct: number;
  range?: { low: number; high: number } | null;
}): string | null {
  if (w.precipPct >= 50) return "rain likely";
  if (w.precipPct >= 30) return "showers possible";
  // Long event with a big temperature swing: "bring layers" is the one thing
  // the reader needs to do about it. A smaller spread still renders as a range,
  // it just doesn't earn the verdict.
  if (w.range && w.range.high - w.range.low >= LAYERS_SWING_F) {
    return "bring layers";
  }
  if (
    w.temp !== null &&
    w.temp >= 80 &&
    (w.condition === "clear" || w.condition === "partly_cloudy")
  ) {
    return "patio weather";
  }
  if (w.temp !== null && w.temp <= 50) return "bring a layer";
  return null;
}
