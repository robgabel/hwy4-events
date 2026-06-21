import type { ResolvedWeather } from "@/lib/weather";
import { conditionColorClass } from "@/lib/weather-conditions";
import { conditionIcon } from "@/lib/weather-icons";

export default function WeatherChip({
  weather,
  qualifier,
  size = "card",
}: {
  weather: ResolvedWeather;
  qualifier: string | null;
  size?: "card" | "detail";
}) {
  const range = weather.range;
  // For a range, the high drives the icon color (the "it gets hot" signal).
  const temp = range ? range.high : weather.temp;
  if (temp === null) return null;

  const Icon = conditionIcon(weather.condition);
  const rainLabel =
    weather.precipPct > 0
      ? `, ${weather.precipPct}% chance of precipitation`
      : "";
  const reading = range
    ? `${range.low} to ${range.high} degrees across the event`
    : `${temp} degrees, ${weather.shortText}`;
  const label = `Weather: ${reading}${rainLabel}`;

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
        className={`h-3.5 w-3.5 ${conditionColorClass(weather.condition, temp)}`}
        strokeWidth={2}
      />
      <span className="tabular-nums">
        {range ? `${range.low}→${range.high}` : temp}&deg;
      </span>
      {qualifier && <span className="text-stone">· {qualifier}</span>}
    </span>
  );
}
