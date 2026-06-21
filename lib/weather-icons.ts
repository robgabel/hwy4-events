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
 * Condition key → lucide-react icon. Kept OUT of lib/weather-conditions.ts on
 * purpose: that module holds the pure forecast logic (mapShortForecast,
 * weatherQualifier, conditionColorClass) that scripts/test/weather.test.ts
 * imports, and the scripts/ test runner resolves modules against
 * scripts/node_modules — which has no lucide-react (a root-only dep). Importing
 * the icons here, only from the UI (WeatherChip/WeatherStrip), keeps the tested
 * logic dependency-free so CI doesn't fail on a missing lucide-react.
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
