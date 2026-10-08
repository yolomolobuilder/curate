/**
 * Date utility functions for CurateCal.
 *
 * CRITICAL: Always use local date methods (getFullYear, getMonth, getDate)
 * instead of toISOString().slice(0, 10).
 * In positive UTC offsets (e.g., UTC+2), toISOString() at 00:30 returns the
 * previous day's UTC date, which corrupts calendar and planning dates.
 */

/**
 * Converts a Date object to 'YYYY-MM-DD' using local calendar date.
 * Guarantees that 00:30 local time in any timezone (including UTC+2) matches
 * the local date rather than rolling back to the previous day.
 */
export function toDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns today's date formatted as 'YYYY-MM-DD' in local time.
 */
export function getTodayStr(): string {
  return toDateStr(new Date());
}

/**
 * Returns tomorrow's date formatted as 'YYYY-MM-DD' in local time.
 */
export function getTomorrowStr(): string {
  return getOffsetDateStr(1);
}

/**
 * Calculates a date offset by `offsetDays` relative to `baseDate` in local time.
 */
export function getOffsetDateStr(offsetDays: number, baseDate: Date = new Date()): string {
  const target = new Date(baseDate);
  target.setDate(target.getDate() + offsetDays);
  return toDateStr(target);
}

/**
 * Parses 'YYYY-MM-DD' into a local Date object without UTC drift.
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns an array of 7 days (Monday to Sunday) for the week containing `baseDate` in local time.
 */
export function getWeekDates(baseDate: Date = new Date()): Array<{ date: Date; dateStr: string }> {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  const week: Array<{ date: Date; dateStr: string }> = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    week.push({
      date: current,
      dateStr: toDateStr(current),
    });
  }
  return week;
}

