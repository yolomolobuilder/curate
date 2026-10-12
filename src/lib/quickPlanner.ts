import {
  ContentItem,
  DayTheme,
  PlanningStrategy,
  QuickPlanProposedItem,
  QuickPlanNotScheduledItem,
  QuickPlanResult,
} from '../types';
import {
  calculateTimeForDateSet,
  getEstimatedDuration,
  formatHoursMinutes,
} from './timeAccounting';
import { toDateStr } from './dateUtils';

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
  todayDateStr?: string; // Explicit reference date for fixed-date deterministic testing
  enableDayPreferences?: boolean; // Toggle for built-in media day preferences (Articles Mon/Tue, etc.)
}

export { getEstimatedDuration };

/**
 * Deterministic Weekly Quick Planning Algorithm
 * 1. Proposes ONLY days from today onward. If no days remain this week, flags noDaysRemainingThisWeek.
 * 2. Compiles a 'Not scheduled' list with clear explanations (e.g. 'Too long for remaining budget: 3h book').
 * 3. Never adds items when the week is already at or above 85% of the budget.
 * 4. Tries combination improvements after first pass to get closer to 85% deterministically.
 * 5. Default strategy: 'Priority, then oldest', duration only breaking ties. 'Shortest first' as an option.
 * 6. Explanations clearly state why each specific day was chosen.
 * 7. Safely handles empty week or empty inbox without crashing.
 */
export function generateQuickPlan({
  inboxItems = [],
  existingWeekItems = [],
  weekDays = [],
  availableBudgetMinutes = 0,
  dayThemes = [],
  strategy = 'priority_oldest',
  todayDateStr,
  enableDayPreferences = true,
}: QuickPlanParams): QuickPlanResult {
  // Normalize strategy: 'thematic_balanced' and 'oldest_first' alias to 'priority_oldest'
  const normalizedStrategy: PlanningStrategy =
    strategy === 'shortest_first' ? 'shortest_first' : 'priority_oldest';

  // 1. Safe handling for empty week
  if (!weekDays || weekDays.length === 0) {
    const candidates = (inboxItems || []).filter(
      (item) => item.status === 'inbox' && !item.scheduledDate
    );
    return {
      proposedItems: [],
      notScheduledItems: candidates.map((item) => ({
        item,
        reason: 'Empty week: No calendar days available for scheduling',
      })),
      totalPlannedMinutes: 0,
      initialScheduledMinutes: 0,
      availableBudgetMinutes,
      remainingMinutes: availableBudgetMinutes,
      isOverBudget: false,
      bufferPercentRemaining: 100,
      strategyUsed: normalizedStrategy,
      noDaysRemainingThisWeek: true,
    };
  }

  // 2. Calculate current planned time for this week using shared counting rule
  const weekDatesSet = new Set(weekDays.map((w) => w.dateStr));
  const { plannedMinutes: initialScheduledMinutes } = calculateTimeForDateSet(
    existingWeekItems,
    weekDatesSet
  );

  // 3. Filter eligible days: ONLY propose days from today onward
  const refTodayStr = todayDateStr || toDateStr(new Date());
  const eligibleDays = weekDays.filter((wd) => wd.dateStr >= refTodayStr);

  const candidates = (inboxItems || []).filter(
    (item) => item.status === 'inbox' && !item.scheduledDate
  );

  // Check if no days remain in this week
  if (eligibleDays.length === 0) {
    return {
      proposedItems: [],
      notScheduledItems: candidates.map((item) => ({
        item,
        reason: 'No days remain this week: All days have already passed',
      })),
      totalPlannedMinutes: initialScheduledMinutes,
      initialScheduledMinutes,
      availableBudgetMinutes,
      remainingMinutes: Math.max(0, availableBudgetMinutes - initialScheduledMinutes),
      isOverBudget: initialScheduledMinutes > availableBudgetMinutes,
      bufferPercentRemaining:
        availableBudgetMinutes > 0
          ? Math.round(
              (Math.max(0, availableBudgetMinutes - initialScheduledMinutes) /
                availableBudgetMinutes) *
                100
            )
          : 0,
      strategyUsed: normalizedStrategy,
      noDaysRemainingThisWeek: true,
    };
  }

  // 4. Budget capacity calculations under strict 85% cap rule
  // Rule 3: Never add items when the week is already above 85% of the budget.
  const targetCapMinutes = Math.floor(availableBudgetMinutes * 0.85);

  if (initialScheduledMinutes >= targetCapMinutes) {
    return {
      proposedItems: [],
      notScheduledItems: candidates.map((item) => ({
        item,
        reason: `Week is already at or above 85% of the budget (${initialScheduledMinutes}m scheduled / ${targetCapMinutes}m 85% cap)`,
      })),
      totalPlannedMinutes: initialScheduledMinutes,
      initialScheduledMinutes,
      availableBudgetMinutes,
      remainingMinutes: Math.max(0, availableBudgetMinutes - initialScheduledMinutes),
      isOverBudget: initialScheduledMinutes > availableBudgetMinutes,
      bufferPercentRemaining:
        availableBudgetMinutes > 0
          ? Math.round(
              (Math.max(0, availableBudgetMinutes - initialScheduledMinutes) /
                availableBudgetMinutes) *
                100
            )
          : 0,
      strategyUsed: normalizedStrategy,
      noDaysRemainingThisWeek: false,
    };
  }

  const availableCapacityUnder85 = Math.max(0, targetCapMinutes - initialScheduledMinutes);

  // 5. Sort candidates deterministically based on strategy
  // Rule 5: Default strategy 'Priority, then oldest', duration only breaking ties. 'Shortest first' as an option.
  const sortedCandidates = [...candidates];

  if (normalizedStrategy === 'shortest_first') {
    sortedCandidates.sort((a, b) => {
      // 1. Priority first
      if (a.isPriority && !b.isPriority) return -1;
      if (!a.isPriority && b.isPriority) return 1;
      // 2. Shortest duration first
      const durA = getEstimatedDuration(a);
      const durB = getEstimatedDuration(b);
      if (durA !== durB) return durA - durB;
      // 3. Oldest first tie-breaker
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    });
  } else {
    // 'priority_oldest': Priority first, then oldest, duration only breaking ties
    sortedCandidates.sort((a, b) => {
      // 1. Priority first
      if (a.isPriority && !b.isPriority) return -1;
      if (!a.isPriority && b.isPriority) return 1;
      // 2. Oldest first
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      if (timeA !== timeB) return timeA - timeB;
      // 3. Duration ONLY breaking ties
      const durA = getEstimatedDuration(a);
      const durB = getEstimatedDuration(b);
      return durA - durB;
    });
  }

  // 6. First Pass: Greedy selection under 85% capacity
  const selectedItems: ContentItem[] = [];
  let plannedNewMinutes = 0;

  for (const item of sortedCandidates) {
    const dur = getEstimatedDuration(item);
    if (plannedNewMinutes + dur <= availableCapacityUnder85) {
      selectedItems.push(item);
      plannedNewMinutes += dur;
    }
  }

  // 7. Rule 4: After first pass, try to get closer to 85% with a better combination of remaining items
  // Keep it strictly deterministic
  const remainingCandidates = sortedCandidates.filter(
    (item) => !selectedItems.some((s) => s.id === item.id)
  );

  // Attempt A: Check if any combinations of remaining candidates fit directly into remaining gap
  let gap = availableCapacityUnder85 - plannedNewMinutes;
  for (const rem of remainingCandidates) {
    const dur = getEstimatedDuration(rem);
    if (dur <= gap) {
      selectedItems.push(rem);
      plannedNewMinutes += dur;
      gap -= dur;
    }
  }

  // Attempt B: If still a gap, check deterministic 1-for-1 or 1-for-2 swaps from remaining items
  // that strictly increase total planned duration without exceeding 85% cap.
  gap = availableCapacityUnder85 - plannedNewMinutes;
  if (gap > 0 && selectedItems.length > 0) {
    const unpicked = sortedCandidates.filter(
      (item) => !selectedItems.some((s) => s.id === item.id)
    );

    let bestSwap: {
      removeIndex: number;
      addItems: ContentItem[];
      netGain: number;
    } | null = null;

    // Check replacing item s with single item r
    for (let sIdx = selectedItems.length - 1; sIdx >= 0; sIdx--) {
      const sItem = selectedItems[sIdx];
      // Only consider swapping non-priority items or lower-priority items
      const sDur = getEstimatedDuration(sItem);

      for (let rIdx = 0; rIdx < unpicked.length; rIdx++) {
        const rItem = unpicked[rIdx];
        if (sItem.isPriority && !rItem.isPriority) continue; // Do not sacrifice priority item for non-priority

        const rDur = getEstimatedDuration(rItem);
        const gain = rDur - sDur;
        if (gain > 0 && gain <= gap) {
          if (!bestSwap || gain > bestSwap.netGain) {
            bestSwap = { removeIndex: sIdx, addItems: [rItem], netGain: gain };
          }
        }
      }

      // Check replacing item s with a pair of items (r1, r2)
      for (let i = 0; i < unpicked.length; i++) {
        for (let j = i + 1; j < unpicked.length; j++) {
          const r1 = unpicked[i];
          const r2 = unpicked[j];
          if (sItem.isPriority && !r1.isPriority && !r2.isPriority) continue;

          const comboDur = getEstimatedDuration(r1) + getEstimatedDuration(r2);
          const gain = comboDur - sDur;
          if (gain > 0 && gain <= gap) {
            if (!bestSwap || gain > bestSwap.netGain) {
              bestSwap = { removeIndex: sIdx, addItems: [r1, r2], netGain: gain };
            }
          }
        }
      }
    }

    if (bestSwap) {
      selectedItems.splice(bestSwap.removeIndex, 1, ...bestSwap.addItems);
      plannedNewMinutes += bestSwap.netGain;
    }
  }

  // 8. Build 'Not scheduled' list with clear, specific reasons (Rule 2)
  const remainingGap = availableCapacityUnder85 - plannedNewMinutes;
  const notScheduledItems: QuickPlanNotScheduledItem[] = [];

  for (const item of sortedCandidates) {
    if (!selectedItems.some((s) => s.id === item.id)) {
      const dur = getEstimatedDuration(item);
      let reason: string;

      if (dur > availableCapacityUnder85) {
        reason = `Too long for the budget: ${formatHoursMinutes(dur)} ${item.contentType} exceeds total 85% capacity (${formatHoursMinutes(availableCapacityUnder85)})`;
      } else if (dur > remainingGap) {
        reason = `Too long for the remaining budget: ${formatHoursMinutes(dur)} ${item.contentType} (needs ${dur}m, only ${remainingGap}m remaining under 85% cap)`;
      } else {
        reason = `Unscheduled: ${formatHoursMinutes(dur)} ${item.contentType} passed over for higher-priority items to hit 85% target`;
      }

      notScheduledItems.push({ item, reason });
    }
  }

  // 9. Day Allocation: Map selected items to eligible days (Rule 1 & Rule 6)
  // Track assigned loads per day
  const dayLoads: Record<string, number> = {};
  eligibleDays.forEach((wd) => {
    dayLoads[wd.dateStr] = wd.currentPlannedMinutes;
  });

  const proposedItems: QuickPlanProposedItem[] = [];

  // Helper scoring function that returns score and clear human reason
  const getSlotScoreAndReason = (
    item: ContentItem,
    slot: WeekDaySlot
  ): { score: number; whyDay: string } => {
    let score = 0;
    const reasons: string[] = [];

    // Check single-day week case
    if (eligibleDays.length === 1) {
      return {
        score: 10,
        whyDay: `Only remaining day this week from today (${slot.dayName})`,
      };
    }

    // 1. Thematic topic match
    const themeTopic = (slot.themeTopic || '').toLowerCase();
    const itemTopic = (item.topic || '').toLowerCase();
    if (themeTopic && itemTopic && themeTopic.includes(itemTopic)) {
      score += 10;
      reasons.push(`Thematic topic match (${slot.themeTopic})`);
    }

    // 2. Built-in media day preferences (if switch is enabled in settings)
    if (enableDayPreferences) {
      if (item.contentType === 'article' && [1, 2].includes(slot.dayOfWeek)) {
        score += 5;
        reasons.push(`Day preference: articles on ${slot.dayName}s`);
      } else if (item.contentType === 'podcast' && [3, 4].includes(slot.dayOfWeek)) {
        score += 5;
        reasons.push(`Day preference: podcasts on ${slot.dayName}s`);
      } else if (
        (item.contentType === 'youtube' || item.contentType === 'documentary') &&
        [5, 6, 0].includes(slot.dayOfWeek)
      ) {
        score += 5;
        reasons.push(`Day preference: videos on ${slot.dayName}s`);
      } else if (item.contentType === 'book' && [0, 6].includes(slot.dayOfWeek)) {
        score += 5;
        reasons.push(`Day preference: books on weekends`);
      }
    }

    // 3. Load balance factor
    const currentLoad = dayLoads[slot.dateStr] || 0;
    score -= currentLoad / 20;

    if (reasons.length === 0) {
      if (currentLoad === 0) {
        reasons.push(`Earliest open day (${slot.dayName}) with no scheduled load`);
      } else {
        reasons.push(`Selected ${slot.dayName} to balance schedule load (${currentLoad}m planned)`);
      }
    }

    return { score, whyDay: reasons.join(' · ') };
  };

  selectedItems.forEach((item) => {
    const duration = getEstimatedDuration(item);

    let bestSlot = eligibleDays[0];
    let bestScore = -Infinity;
    let bestWhyDay = `Assigned to ${bestSlot.dayName}`;

    eligibleDays.forEach((slot) => {
      const { score, whyDay } = getSlotScoreAndReason(item, slot);
      if (score > bestScore) {
        bestScore = score;
        bestSlot = slot;
        bestWhyDay = whyDay;
      }
    });

    // Update day load
    dayLoads[bestSlot.dateStr] = (dayLoads[bestSlot.dateStr] || 0) + duration;

    // Full explainable reason (Rule 6)
    const extraDetails: string[] = [];
    if (item.isPriority) extraDetails.push('★ Priority');
    extraDetails.push(`${duration}m duration`);

    const explanation = `${bestWhyDay} · ${extraDetails.join(' · ')}`;

    proposedItems.push({
      item,
      targetDateStr: bestSlot.dateStr,
      dayLabel: bestSlot.dayName,
      explanation,
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
    notScheduledItems,
    totalPlannedMinutes,
    initialScheduledMinutes,
    availableBudgetMinutes,
    remainingMinutes,
    isOverBudget,
    bufferPercentRemaining,
    strategyUsed: normalizedStrategy,
    noDaysRemainingThisWeek: false,
  };
}
