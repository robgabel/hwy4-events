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
import type { ConditionKey } from "./weather-conditions";

/**
 * Maps a stable ConditionKey to its Lucide icon component. Split out from
 * weather-conditions.ts so the pure forecast logic there (mapShortForecast,
 * weatherQualifier, conditionColorClass) stays dependency-free and unit-testable
 * from the scraper package, which does not install React / lucide-react.
 */
export function conditionIcon(key: ConditionKey): ComponentType<LucideProps> {
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
