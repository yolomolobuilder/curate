import { ContentItem } from '../types';

/**
 * Returns duration in minutes if specified, otherwise deterministic fallback based on media type.
 */
export function getEstimatedDuration(item: ContentItem): number {
  if (item.durationMinutes && item.durationMinutes > 0) {
    return item.durationMinutes;
  }
  switch (item.contentType) {
    case 'youtube':
    case 'documentary':
      return 25;
    case 'podcast':
      return 45;
    case 'article':
      return 12;
    case 'book':
    case 'course':
      return 30;
    default:
      return 20;
  }
}

/**
 * Consistent duration formatter across all views (e.g. '180m' -> '3h', '70m' -> '1h 10m', '45m' -> '45m').
 */
export function formatHoursMinutes(mins: number): string {
  const absMins = Math.abs(mins);
  const h = Math.floor(absMins / 60);
  const m = absMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Consistent duration formatter across cards, preview bars, and modals.
 * Returns empty string for undefined/null/non-positive minutes.
 */
export function formatDuration(mins?: number | null): string {
  if (mins === undefined || mins === null || mins <= 0) return '';
  return formatHoursMinutes(mins);
}

function parseDateParts(dStr: string): [number, number, number] {
  const [y, m, d] = dStr.split('-').map(Number);
  return [y, m, d];
}

/**
 * Calculates day difference using Date.UTC to prevent any timezone/DST discrepancies.
 */
export function getDaysDifference(startStr: string, endStr: string): number {
  const [y1, m1, d1] = parseDateParts(startStr);
  const [y2, m2, d2] = parseDateParts(endStr);
  const date1 = Date.UTC(y1, m1 - 1, d1);
  const date2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((date2 - date1) / (1000 * 60 * 60 * 24));
}

export interface ItemMultiDayInfo {
  isMultiDay: boolean;
  isStartDay: boolean;
  isContinuation: boolean;
  dayNumber: number;
  totalDays: number;
}

/**
 * Inspects whether an item is multi-day and whether dateStr is its start date or a later continuation day.
 */
export function getItemMultiDayInfo(item: ContentItem, dateStr: string): ItemMultiDayInfo {
  if (!item.scheduledDate || !item.scheduledEndDate || item.scheduledEndDate <= item.scheduledDate) {
    return {
      isMultiDay: false,
      isStartDay: item.scheduledDate === dateStr,
      isContinuation: false,
      dayNumber: 1,
      totalDays: 1,
    };
  }

  const totalDays = getDaysDifference(item.scheduledDate, item.scheduledEndDate) + 1;

  if (dateStr === item.scheduledDate) {
    return {
      isMultiDay: true,
      isStartDay: true,
      isContinuation: false,
      dayNumber: 1,
      totalDays,
    };
  }

  if (dateStr > item.scheduledDate && dateStr <= item.scheduledEndDate) {
    const dayNumber = getDaysDifference(item.scheduledDate, dateStr) + 1;
    return {
      isMultiDay: true,
      isStartDay: false,
      isContinuation: true,
      dayNumber,
      totalDays,
    };
  }

  return {
    isMultiDay: true,
    isStartDay: false,
    isContinuation: false,
    dayNumber: 0,
    totalDays,
  };
}

export interface TimeAccountingResult {
  plannedMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
  isOverBudget: boolean;
  itemCount: number;
}

/**
 * Universal counting rule for a single day:
 * - An item with a start and end date counts its full duration once, on its start date.
 * - It adds 0 minutes on later days.
 * - Completed items count in PLANNED.
 * - Completed duration is tracked in completedMinutes ('Done Xh Xm').
 */
export function calculateTimeForDate(
  items: ContentItem[],
  dateStr: string,
  availableMinutes: number = 0
): TimeAccountingResult {
  let plannedMinutes = 0;
  let completedMinutes = 0;
  let itemCount = 0;

  for (const item of items) {
    if (item.status === 'inbox') continue;
    // Strictly count on exact start date only
    if (item.scheduledDate === dateStr) {
      const dur = getEstimatedDuration(item);
      plannedMinutes += dur;
      itemCount++;
      if (item.status === 'completed') {
        completedMinutes += dur;
      }
    }
  }

  const remainingMinutes = availableMinutes - plannedMinutes;
  const isOverBudget = availableMinutes > 0 && plannedMinutes > availableMinutes;

  return {
    plannedMinutes,
    completedMinutes,
    remainingMinutes,
    isOverBudget,
    itemCount,
  };
}

/**
 * Universal counting rule for a date set or range (e.g. Week):
 * - Items whose scheduledDate falls in dateSet count once.
 * - Multi-day items add 0 minutes for continuation days.
 * - Completed items count in plannedMinutes, and are tracked in completedMinutes.
 * - REMAINING = AVAILABLE - PLANNED.
 */
export function calculateTimeForDateSet(
  items: ContentItem[],
  dateSet: Set<string>,
  availableMinutes: number = 0
): TimeAccountingResult {
  let plannedMinutes = 0;
  let completedMinutes = 0;
  let itemCount = 0;

  for (const item of items) {
    if (item.status === 'inbox') continue;
    // Count once on start date if start date is within dateSet
    if (item.scheduledDate && dateSet.has(item.scheduledDate)) {
      const dur = getEstimatedDuration(item);
      plannedMinutes += dur;
      itemCount++;
      if (item.status === 'completed') {
        completedMinutes += dur;
      }
    }
  }

  const remainingMinutes = availableMinutes - plannedMinutes;
  const isOverBudget = availableMinutes > 0 && plannedMinutes > availableMinutes;

  return {
    plannedMinutes,
    completedMinutes,
    remainingMinutes,
    isOverBudget,
    itemCount,
  };
}

/**
 * Universal counting rule for Month calendar:
 * - Items whose scheduledDate starts with YYYY-MM count once.
 * - Completed items count in PLANNED.
 */
export function calculateTimeForMonth(
  items: ContentItem[],
  year: number,
  month: number
): { plannedMinutes: number; completedMinutes: number; itemCount: number } {
  const ymPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  let plannedMinutes = 0;
  let completedMinutes = 0;
  let itemCount = 0;

  for (const item of items) {
    if (item.status === 'inbox') continue;
    if (item.scheduledDate && item.scheduledDate.startsWith(ymPrefix)) {
      const dur = getEstimatedDuration(item);
      plannedMinutes += dur;
      itemCount++;
      if (item.status === 'completed') {
        completedMinutes += dur;
      }
    }
  }

  return { plannedMinutes, completedMinutes, itemCount };
}

/**
 * Flexible duration parser that converts human input like '4h', '4', '240m', '1h 30m', '2.5h' into minutes.
 * - Handles '4h', '4 hrs', '4 hours' -> 240
 * - Handles '90m', '90 mins', '90 minutes' -> 90
 * - Handles '1h 30m', '2h 15min' -> 90, 135
 * - Handles '2.5h' or '1,5h' -> 150, 90
 * - Handles bare numbers without units:
 *   If <= 16, assumes hours (e.g. '4' -> 240 mins) for weekly budget intent.
 *   If > 16, assumes minutes (e.g. '90' -> 90 mins).
 * Returns null if invalid or <= 0.
 */
export function parseDurationInput(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase().replace(',', '.');
  if (!trimmed) return null;

  // Pattern 1: Combined hours and minutes, e.g. "2h 30m" or "2h30m" or "1 hour 20 mins"
  const comboMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(\d+)\s*(?:m|min|mins|minutes?)?$/);
  if (comboMatch) {
    const hours = parseFloat(comboMatch[1]);
    const mins = parseInt(comboMatch[2], 10);
    if (!isNaN(hours) && !isNaN(mins)) {
      return Math.round(hours * 60 + mins);
    }
  }

  // Pattern 2: Explicit hours, e.g. "4h", "2.5h", "3 hours", "1.5 hrs"
  const hoursMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)$/);
  if (hoursMatch) {
    const hours = parseFloat(hoursMatch[1]);
    if (!isNaN(hours) && hours > 0) {
      return Math.round(hours * 60);
    }
  }

  // Pattern 3: Explicit minutes, e.g. "90m", "45 mins", "120 min"
  const minsMatch = trimmed.match(/^(\d+)\s*(?:m|min|mins|minutes?)$/);
  if (minsMatch) {
    const mins = parseInt(minsMatch[1], 10);
    if (!isNaN(mins) && mins > 0) {
      return mins;
    }
  }

  // Pattern 4: Bare number (with possible decimal), e.g. "4", "2.5", "120"
  const bareNum = parseFloat(trimmed);
  if (!isNaN(bareNum) && bareNum > 0) {
    // If <= 16, assume hours for weekly budget intent; if > 16, assume minutes
    if (bareNum <= 16) {
      return Math.round(bareNum * 60);
    }
    return Math.round(bareNum);
  }

  return null;
}

/**
 * Compact duration string representation for custom inputs, e.g. 240 -> "4h", 90 -> "1h 30m"
 */
export function formatDurationCompact(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
