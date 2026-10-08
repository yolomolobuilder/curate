import {
  ContentItem,
  DayTheme,
  PlanningStrategy,
  QuickPlanProposedItem,
  QuickPlanResult,
} from '../types';

export interface WeekDaySlot {
  dateStr: string; // YYYY-MM-DD
  date: Date;
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ...
  dayName: string; // 'Monday', 'Tuesday', ...
  themeTopic?: string;
  currentPlannedMinutes: number;
}

export interface QuickPlanParams {
  inboxItems: ContentItem[];
  existingWeekItems: ContentItem[];
  weekDays: WeekDaySlot[];
  availableBudgetMinutes: number;
  dayThemes?: DayTheme[];
  strategy?: PlanningStrategy;
}

import {
  calculateTimeForDateSet,
  getEstimatedDuration,
} from './timeAccounting';

export { getEstimatedDuration };

/**
 * Deterministic & Explainable Weekly Quick Planning Algorithm
 * Zero AI / Zero Model Calls
 */
export function generateQuickPlan({
  inboxItems,
  existingWeekItems,
  weekDays,
  availableBudgetMinutes,
  dayThemes = [],
  strategy = 'thematic_balanced',
}: QuickPlanParams): QuickPlanResult {
  // 1. Calculate current planned time for this week using shared counting rule
  // (Counts full duration once on start date, completed items count in PLANNED)
  const weekDatesSet = new Set(weekDays.map((w) => w.dateStr));
  const { plannedMinutes: initialScheduledMinutes } = calculateTimeForDateSet(
    existingWeekItems,
    weekDatesSet
  );

  // 2. Budget capacity calculation:
  // Default behavior aims to leave ~10-20% of total budget free when possible (target 85% of budget).
  const targetTotalMinutes = Math.max(0, Math.round(availableBudgetMinutes * 0.85));
  const capacityToFill = Math.max(0, targetTotalMinutes - initialScheduledMinutes);

  // 3. Filter eligible items: active inbox items not yet completed
  const candidates = inboxItems.filter(
    (item) => item.status === 'inbox' && !item.scheduledDate
  );

  // 4. Sort / score candidates deterministically based on strategy
  const sortedCandidates = [...candidates];

  switch (strategy) {
    case 'oldest_first':
      sortedCandidates.sort((a, b) => {
        // Priority first, then oldest createdAt
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeA - timeB;
      });
      break;

    case 'shortest_first':
      sortedCandidates.sort((a, b) => {
        // Priority first, then shortest duration
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        return getEstimatedDuration(a) - getEstimatedDuration(b);
      });
      break;

    case 'alternate_type': {
      // Group by content type and interleave in round-robin
      const groups: Record<string, ContentItem[]> = {};
      sortedCandidates.forEach((item) => {
        const type = item.contentType || 'other';
        if (!groups[type]) groups[type] = [];
        groups[type].push(item);
      });
      // Sort items within each group: priority first, then oldest
      Object.values(groups).forEach((list) => {
        list.sort((a, b) => {
          if (a.isPriority && !b.isPriority) return -1;
          if (!a.isPriority && b.isPriority) return 1;
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        });
      });

      const interleaved: ContentItem[] = [];
      const types = Object.keys(groups);
      let added = true;
      let index = 0;
      while (added) {
        added = false;
        for (const t of types) {
          if (groups[t][index]) {
            interleaved.push(groups[t][index]);
            added = true;
          }
        }
        index++;
      }
      sortedCandidates.splice(0, sortedCandidates.length, ...interleaved);
      break;
    }

    case 'thematic_balanced':
    default:
      // Balanced: Starred priority items given first preference, then balance by duration & age
      sortedCandidates.sort((a, b) => {
        const scoreA = (a.isPriority ? 1000 : 0) - getEstimatedDuration(a) * 0.1;
        const scoreB = (b.isPriority ? 1000 : 0) - getEstimatedDuration(b) * 0.1;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });
      break;
  }

  // 5. Select items fitting the capacity
  const selectedItems: ContentItem[] = [];
  let plannedNewMinutes = 0;

  for (const item of sortedCandidates) {
    const itemMins = getEstimatedDuration(item);
    // If we have remaining capacity or if nothing is selected yet and it's within full budget
    if (
      plannedNewMinutes + itemMins <= capacityToFill ||
      (selectedItems.length === 0 && initialScheduledMinutes + itemMins <= availableBudgetMinutes)
    ) {
      selectedItems.push(item);
      plannedNewMinutes += itemMins;
    }
  }

  // 6. Map selected items to week days (grouping by category on thematic days)
  // Track assigned minutes per day
  const dayLoads: Record<string, number> = {};
  weekDays.forEach((wd) => {
    dayLoads[wd.dateStr] = wd.currentPlannedMinutes;
  });

  const proposedItems: QuickPlanProposedItem[] = [];

  // Helper to test if a day theme matches an item
  const getThematicAffinity = (item: ContentItem, slot: WeekDaySlot): number => {
    let score = 0;
    const themeStr = (slot.themeTopic || '').toLowerCase();
    const typeStr = item.contentType.toLowerCase();
    const topicStr = (item.topic || '').toLowerCase();

    if (themeStr) {
      if (themeStr.includes(typeStr) || (typeStr === 'youtube' && themeStr.includes('video'))) {
        score += 5;
      }
      if (topicStr && themeStr.includes(topicStr)) {
        score += 8;
      }
    }

    // Default media-friendly scheduling:
    // Videos on Fri/Sat/Sun, Articles on Mon/Tue, Podcasts on Wed/Thu
    if (item.contentType === 'youtube' && [5, 6, 0].includes(slot.dayOfWeek)) score += 2;
    if (item.contentType === 'article' && [1, 2].includes(slot.dayOfWeek)) score += 2;
    if (item.contentType === 'podcast' && [3, 4].includes(slot.dayOfWeek)) score += 2;
    if (item.contentType === 'book' && [0, 6].includes(slot.dayOfWeek)) score += 2;

    // Prefer days with less load
    const currentLoad = dayLoads[slot.dateStr] || 0;
    score -= currentLoad / 30; // Mild penalty for loaded days

    return score;
  };

  selectedItems.forEach((item) => {
    const duration = getEstimatedDuration(item);

    // Find the best week day for this item
    let bestSlot = weekDays[0];
    let bestScore = -Infinity;

    weekDays.forEach((slot) => {
      const affinity = getThematicAffinity(item, slot);
      if (affinity > bestScore) {
        bestScore = affinity;
        bestSlot = slot;
      }
    });

    // Update day load
    dayLoads[bestSlot.dateStr] = (dayLoads[bestSlot.dateStr] || 0) + duration;

    // Build explainable tag
    const reasons: string[] = [];
    if (item.isPriority) {
      reasons.push('★ High priority');
    }
    if (bestSlot.themeTopic) {
      reasons.push(`Thematic match: ${bestSlot.themeTopic}`);
    } else {
      reasons.push(`Slotted to ${bestSlot.dayName}`);
    }
    reasons.push(`${duration}m duration`);

    if (strategy === 'oldest_first') {
      reasons.push('Oldest backlog item');
    } else if (strategy === 'shortest_first') {
      reasons.push('Quick win session');
    } else if (strategy === 'alternate_type') {
      reasons.push(`Type rotation (${item.contentType})`);
    }

    proposedItems.push({
      item,
      targetDateStr: bestSlot.dateStr,
      dayLabel: bestSlot.dayName,
      explanation: reasons.join(' · '),
      isSelected: true,
    });
  });

  const totalPlannedMinutes = initialScheduledMinutes + plannedNewMinutes;
  const remainingMinutes = Math.max(0, availableBudgetMinutes - totalPlannedMinutes);
  const isOverBudget = totalPlannedMinutes > availableBudgetMinutes;
  const bufferPercentRemaining =
    availableBudgetMinutes > 0
      ? Math.round((remainingMinutes / availableBudgetMinutes) * 100)
      : 0;

  return {
    proposedItems,
    totalPlannedMinutes,
    initialScheduledMinutes,
    availableBudgetMinutes,
    remainingMinutes,
    isOverBudget,
    bufferPercentRemaining,
    strategyUsed: strategy,
  };
}
