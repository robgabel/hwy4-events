import type { ComponentType } from "react";
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Wind,
  type LucideProps,
} from "lucide-react";

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

export function conditionIcon(
  key: ConditionKey
): ComponentType<LucideProps> {
  switch (key) {
    case "clear":
      return Sun;
    case "partly_cloudy":
      return CloudSun;
    case "cloudy":
      return Cloud;
    case "rain":
      return CloudRain;
    case "snow":
      return CloudSnow;
    case "fog":
      return CloudFog;
    case "storm":
      return CloudLightning;
    case "windy":
      return Wind;
  }
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

/**
 * A short scene-setting tag from the event-HOUR reading. Temp is the forecast
 * temperature at the event's start hour, so "patio weather" / "bring a layer"
 * reflect how it'll actually feel when you're there, not the day's high or low.
 */
export function weatherQualifier(w: {
  temp: number | null;
  condition: ConditionKey;
  precipPct: number;
}): string | null {
  if (w.precipPct >= 50) return "rain likely";
  if (w.precipPct >= 30) return "showers possible";
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
