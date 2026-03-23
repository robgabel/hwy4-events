/**
 * Native date utilities that replace date-fns in client components.
 * Eliminates ~13KB of date-fns from the client JS bundle,
 * dramatically reducing hydration time on mobile.
 */

/** Parse "YYYY-MM-DD" to a local-time Date (matches date-fns parseISO for date-only strings) */
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  );
}

/** Check if date falls within the current calendar week (Sun–Sat) */
export function isThisWeek(date: Date): boolean {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay()); // back to Sunday
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

export function differenceInCalendarDays(left: Date, right: Date): number {
  const a = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const b = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((a - b) / 86_400_000);
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getNextFriday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const daysUntilFri = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilFri);
  return d;
}

// ── Formatting ──────────────────────────────────────────

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Mon" */
export function formatShortWeekday(date: Date): string {
  return WEEKDAY_SHORT[date.getDay()];
}

/** "Monday" */
export function formatLongWeekday(date: Date): string {
  return WEEKDAY_LONG[date.getDay()];
}

/** "5" */
export function formatDayOfMonth(date: Date): string {
  return String(date.getDate());
}

/** "Jan" */
export function formatShortMonth(date: Date): string {
  return MONTH_SHORT[date.getMonth()];
}

/** "Jan 5" */
export function formatShortMonthDay(date: Date): string {
  return `${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "January 5" */
export function formatLongMonthDay(date: Date): string {
  return `${MONTH_LONG[date.getMonth()]} ${date.getDate()}`;
}

/** "Monday, January 5, 2026" */
export function formatFullDate(date: Date): string {
  return `${WEEKDAY_LONG[date.getDay()]}, ${MONTH_LONG[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "2026-01-05" */
export function formatISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
