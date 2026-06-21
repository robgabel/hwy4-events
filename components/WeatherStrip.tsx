import { addDays, pacificToday } from "@/lib/date-windows";
import type { Forecast } from "@/lib/weather";
import { getWeatherForDate } from "@/lib/weather";
import { conditionColorClass } from "@/lib/weather-conditions";
import { conditionIcon } from "@/lib/weather-icons";

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatShortTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(" ", "")
    .toLowerCase();
}

function comfortScore(day: NonNullable<ReturnType<typeof getWeatherForDate>>) {
  const temp = day.highF ?? day.lowF ?? 55;
  const tempScore = Math.max(0, 35 - Math.abs(temp - 74));
  const precipScore = Math.max(0, 30 - day.precipPct);
  const conditionScore =
    day.condition === "clear" || day.condition === "partly_cloudy"
      ? 12
      : day.condition === "rain" || day.condition === "storm"
        ? -12
        : 0;
  return tempScore + precipScore + conditionScore;
}

export default function WeatherStrip({
  forecast,
  days = 3,
  startDate,
  context = "surface",
}: {
  forecast: Forecast | null;
  days?: number;
  startDate?: string;
  context?: "hero" | "surface";
}) {
  if (!forecast) return null;

  const first = startDate ?? pacificToday().iso;
  const rows = Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    const day = getWeatherForDate(forecast, date);
    return day ? { date, day } : null;
  }).filter(Boolean) as Array<{
    date: string;
    day: NonNullable<ReturnType<typeof getWeatherForDate>>;
  }>;

  if (rows.length === 0) return null;

  const best = [...rows].sort((a, b) => comfortScore(b.day) - comfortScore(a.day))[0];
  const bestTemp = best.day.highF ?? best.day.lowF;
  const summary =
    bestTemp !== null
      ? `${formatWeekday(best.date)} looks easiest: ${bestTemp}° and ${best.day.shortText.toLowerCase()}.`
      : `${formatWeekday(best.date)} looks easiest for outdoor plans.`;

  const shellClass =
    context === "hero"
      ? "text-cream"
      : "text-forest";
  const mutedClass =
    context === "hero"
      ? "text-cream/75"
      : "text-stone";

  return (
    <section
      aria-label="Weekend weather"
      className={`mt-4 max-w-xl ${shellClass}`}
    >
      <ul className="flex rounded-lg border border-current/15 bg-white/60 text-sm backdrop-blur-none sm:max-w-md">
        {rows.map(({ date, day }, index) => {
          const Icon = conditionIcon(day.condition);
          const precip = day.precipPct >= 20 ? `${day.precipPct}%` : null;
          return (
            <li
              key={date}
              aria-label={`${formatWeekday(date)} weather: ${day.shortText}, high ${day.highF ?? "unknown"}, low ${day.lowF ?? "unknown"}${precip ? `, ${precip} precipitation` : ""}`}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-2.5 py-2 text-center ${
                index > 0 ? "border-l border-current/15" : ""
              }`}
            >
              <span className={`text-[10px] font-bold uppercase tracking-wide ${mutedClass}`}>
                {formatWeekday(date)}
              </span>
              <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                <Icon
                  aria-hidden="true"
                  className={`h-4 w-4 ${conditionColorClass(day.condition, day.highF)}`}
                  strokeWidth={2}
                />
                {day.highF ?? "--"}°/{day.lowF ?? "--"}°
              </span>
              {precip && <span className={`text-[11px] ${mutedClass}`}>{precip}</span>}
            </li>
          );
        })}
      </ul>
      <p className={`mt-2 text-sm leading-snug ${mutedClass}`}>{summary}</p>
      <p className={`mt-1 text-xs ${mutedClass}`}>
        Sunset {formatShortTime(forecast.sunset)}
      </p>
    </section>
  );
}
