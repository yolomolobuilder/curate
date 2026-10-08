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
