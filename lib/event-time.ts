export type LiveStatus = "live" | "starting-soon" | null;

/**
 * Get the live status of an event based on current time in Pacific time.
 * Returns "live" if event is in progress, "starting-soon" if within 90 min, null otherwise.
 */
export function getEventLiveStatus(
  eventDate: string, // "2026-03-20"
  startTime: string | null, // "19:00" or "7:00 PM"
  endTime: string | null // "22:00" or null
): LiveStatus {
  if (!startTime) return null;

  const now = new Date();

  // Get current time in Pacific
  const pacificNow = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );

  const startDate = parseEventDateTime(eventDate, startTime);
  if (!startDate) return null;

  const endDate = endTime
    ? parseEventDateTime(eventDate, endTime)
    : new Date(startDate.getTime() + 4 * 60 * 60 * 1000); // default 4 hours

  if (!endDate) return null;

  const msUntilStart = startDate.getTime() - pacificNow.getTime();
  const msUntilEnd = endDate.getTime() - pacificNow.getTime();

  // Currently live: past start, before end
  if (msUntilStart <= 0 && msUntilEnd > 0) {
    return "live";
  }

  // Starting soon: within 90 minutes before start
  if (msUntilStart > 0 && msUntilStart <= 90 * 60 * 1000) {
    return "starting-soon";
  }

  return null;
}

function parseEventDateTime(
  dateStr: string,
  timeStr: string
): Date | null {
  try {
    // Normalize time to 24h format
    const time24 = to24Hour(timeStr.trim());
    if (!time24) return null;

    const [hours, minutes] = time24.split(":").map(Number);
    const [year, month, day] = dateStr.split("-").map(Number);

    const date = new Date(year, month - 1, day, hours, minutes);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
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
