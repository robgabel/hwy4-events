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

type WeatherEvent = {
  start_time?: string | null;
};

type DayLike = {
  highF: number | null;
  lowF: number | null;
  condition: ConditionKey;
  precipPct: number;
};

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

function startsInEvening(event: WeatherEvent): boolean {
  if (!event.start_time) return false;
  const hour = Number(event.start_time.slice(0, 2));
  return Number.isFinite(hour) && hour >= 17;
}

export function weatherQualifier(
  day: DayLike,
  event: WeatherEvent
): string | null {
  if (day.precipPct >= 50) return "rain likely";
  if (day.precipPct >= 30) return "showers possible";
  if (
    startsInEvening(event) &&
    day.highF !== null &&
    day.highF >= 78 &&
    (day.condition === "clear" || day.condition === "partly_cloudy")
  ) {
    return "patio weather";
  }
  if (startsInEvening(event) && day.lowF !== null && day.lowF <= 48) {
    return "chilly evening";
  }
  return null;
}

export function displayWeatherTemp(day: DayLike, event: WeatherEvent): number | null {
  if (startsInEvening(event) && day.lowF !== null) return day.lowF;
  return day.highF ?? day.lowF;
}
