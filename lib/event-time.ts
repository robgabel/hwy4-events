export type LiveStatus =
  | { type: "live" }
  | { type: "starting-soon"; minutesUntil: number }
  | null;

/**
 * Get the live status of an event based on current time in Pacific time.
 * Returns "live" if event is in progress, "starting-soon" with minutes if within 90 min, null otherwise.
 *
 * This runs client-side (browser), so we compare the browser's local clock
 * against event times that are stored in Pacific time. We use Intl to get
 * the current Pacific time, then build both dates in the same frame.
 */
export function getEventLiveStatus(
  eventDate: string, // "2026-03-20"
  startTime: string | null, // "19:00" or "7:00 PM"
  endTime: string | null // "22:00" or null
): LiveStatus {
  if (!startTime) return null;

  // Get current time expressed as Pacific wall-clock values
  const now = new Date();
  const pacificParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) =>
    parseInt(pacificParts.find((p) => p.type === type)?.value || "0", 10);

  const nowMinutes =
    get("year") * 525960 +
    (get("month") - 1) * 43830 +
    get("day") * 1440 +
    get("hour") * 60 +
    get("minute");

  // Parse event start as Pacific wall-clock minutes
  const startMinutes = toAbsoluteMinutes(eventDate, startTime);
  if (startMinutes === null) return null;

  const endMinutes = endTime
    ? toAbsoluteMinutes(eventDate, endTime)
    : startMinutes + 240; // default 4 hours

  if (endMinutes === null) return null;

  const minutesUntilStart = startMinutes - nowMinutes;
  const minutesUntilEnd = endMinutes - nowMinutes;

  // Currently live: past start, before end
  if (minutesUntilStart <= 0 && minutesUntilEnd > 0) {
    return { type: "live" };
  }

  // Starting soon: within 90 minutes before start
  if (minutesUntilStart > 0 && minutesUntilStart <= 90) {
    return { type: "starting-soon", minutesUntil: minutesUntilStart };
  }

  return null;
}

/**
 * Convert a date + time string into absolute minutes for comparison.
 * Uses the same year*525960 + month*43830 + day*1440 scheme — not
 * astronomically precise, but consistent for same-day comparisons.
 */
function toAbsoluteMinutes(dateStr: string, timeStr: string): number | null {
  const time24 = to24Hour(timeStr.trim());
  if (!time24) return null;

  const [hours, minutes] = time24.split(":").map(Number);
  const [year, month, day] = dateStr.split("-").map(Number);

  return year * 525960 + (month - 1) * 43830 + day * 1440 + hours * 60 + minutes;
}

function to24Hour(time: string): string | null {
  // Already 24h format like "19:00"
  if (/^\d{1,2}:\d{2}$/.test(time)) return time;

  // 12h format like "7:00 PM" or "7:00PM"
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();

  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  return `${hours}:${minutes}`;
}
