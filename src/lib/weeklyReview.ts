import { ContentItem } from '../types';
import { getWeekDates, parseLocalDate, toDateStr } from './dateUtils';
import { calculateTimeForDate, getEstimatedDuration } from './timeAccounting';

export interface WeeklyReviewTotals {
  plannedMinutes: number;
  completedMinutes: number;
  unfinishedMinutes: number;
  completionRate: number; // 0 to 100
  totalItemsCount: number;
  completedCount: number;
  unfinishedCount: number;
}

export interface WeeklyReviewRange {
  startDate: Date;
  endDate: Date;
  startStr: string;
  endStr: string;
  label: string;
  weekDates: Array<{ date: Date; dateStr: string }>;
}

export interface WeeklyReviewData {
  range: WeeklyReviewRange;
  totals: WeeklyReviewTotals;
  completedItems: ContentItem[];
  stillInterestedItems: ContentItem[];
  didntGetToItems: ContentItem[];
  allUnfinishedItems: ContentItem[];
}

/**
 * Returns the date range (Monday to Sunday) of the week immediately preceding `baseDate`.
 */
export function getPreviousWeekRange(baseDate: Date = new Date()): WeeklyReviewRange {
  const currentWeek = getWeekDates(baseDate);
  const currentMonday = currentWeek[0].date;

  // Subtract 7 days to get previous week's Monday
  const prevMonday = new Date(currentMonday);
  prevMonday.setDate(currentMonday.getDate() - 7);

  const prevWeek = getWeekDates(prevMonday);
  const startDate = prevWeek[0].date;
  const endDate = prevWeek[6].date;
  const startStr = prevWeek[0].dateStr;
  const endStr = prevWeek[6].dateStr;

  const monLabel = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sunLabel = endDate.toLocaleDateString('en-US', {
    month: startDate.getMonth() === endDate.getMonth() ? undefined : 'short',
    day: 'numeric',
    year: startDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });

  return {
    startDate,
    endDate,
    startStr,
    endStr,
    label: `${monLabel} – ${sunLabel}`,
    weekDates: prevWeek,
  };
}

/**
 * Calculates factual previous-week metrics and partitions items.
 * Strictly zero AI commentary or motivational copy.
 */
export function getWeeklyReviewData(
  items: ContentItem[],
  baseDate: Date = new Date(),
  overrides?: Record<string, 'still_interested' | 'didnt_get_to'>
): WeeklyReviewData {
  const range = getPreviousWeekRange(baseDate);

  // Time totals across the 7 days of previous week
  let plannedMinutes = 0;
  let completedMinutes = 0;

  for (const day of range.weekDates) {
    const dayResult = calculateTimeForDate(items, day.dateStr);
    plannedMinutes += dayResult.plannedMinutes;
    completedMinutes += dayResult.completedMinutes;
  }

  const unfinishedMinutes = Math.max(0, plannedMinutes - completedMinutes);
  const completionRate =
    plannedMinutes > 0 ? Math.min(100, Math.round((completedMinutes / plannedMinutes) * 100)) : 0;

  // Filter items whose scheduledDate falls within the previous week range
  const weekItems = items.filter(
    (item) =>
      item.status !== 'inbox' &&
      item.scheduledDate &&
      item.scheduledDate >= range.startStr &&
      item.scheduledDate <= range.endStr
  );

  const completedItems = weekItems.filter((item) => item.status === 'completed');
  const allUnfinishedItems = weekItems.filter((item) => item.status !== 'completed');

  // Partition unfinished items into "Still interested" and "Didn't get to"
  const stillInterestedItems: ContentItem[] = [];
  const didntGetToItems: ContentItem[] = [];

  for (const item of allUnfinishedItems) {
    const override = overrides?.[item.id];
    if (override === 'still_interested') {
      stillInterestedItems.push(item);
    } else if (override === 'didnt_get_to') {
      didntGetToItems.push(item);
    } else if (item.isPriority) {
      // Priority items default to Still Interested
      stillInterestedItems.push(item);
    } else {
      // Others default to Didn't get to
      didntGetToItems.push(item);
    }
  }

  return {
    range,
    totals: {
      plannedMinutes,
      completedMinutes,
      unfinishedMinutes,
      completionRate,
      totalItemsCount: weekItems.length,
      completedCount: completedItems.length,
      unfinishedCount: allUnfinishedItems.length,
    },
    completedItems,
    stillInterestedItems,
    didntGetToItems,
    allUnfinishedItems,
  };
}

/**
 * Triage: Keep item in backlog/inbox
 */
export function keepItemInBacklog(item: ContentItem): ContentItem {
  return {
    ...item,
    status: 'inbox',
    scheduledDate: undefined,
    scheduledEndDate: undefined,
  };
}

/**
 * Triage: Reschedule item to a specific date
 */
export function rescheduleItemToDate(item: ContentItem, targetDateStr: string): ContentItem {
  return {
    ...item,
    status: 'planned',
    scheduledDate: targetDateStr,
    scheduledEndDate: undefined,
  };
}
