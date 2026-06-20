import type { DayWeather } from "@/lib/weather";
import {
  conditionColorClass,
  conditionIcon,
  displayWeatherTemp,
} from "@/lib/weather-conditions";

type WeatherChipEvent = {
  start_time?: string | null;
};

export default function WeatherChip({
  day,
  qualifier,
  event,
  size = "card",
}: {
  day: DayWeather;
  qualifier: string | null;
  event: WeatherChipEvent;
  size?: "card" | "detail";
}) {
  const Icon = conditionIcon(day.condition);
  const temp = displayWeatherTemp(day, event);
  if (temp === null) return null;

  const rainLabel =
    day.precipPct > 0 ? `, ${day.precipPct}% chance of precipitation` : "";
  const label = `Weather: ${temp} degrees, ${day.shortText}${rainLabel}`;

  return (
    <span
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-warm-white text-forest ${
        size === "detail"
          ? "px-2.5 py-1 text-xs font-semibold"
          : "px-2 py-0.5 text-[11px] font-semibold"
      }`}
    >
      <Icon
        aria-hidden="true"
        className={`h-3.5 w-3.5 ${conditionColorClass(day.condition, day.highF)}`}
        strokeWidth={2}
      />
      <span className="tabular-nums">{temp}&deg;</span>
      {qualifier && <span className="text-stone">· {qualifier}</span>}
    </span>
  );
}
