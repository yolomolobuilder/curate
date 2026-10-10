import { trackEvent, getSecondsSinceOpen } from './analytics';

export interface ActivationState {
  startedAt: string;
  itemsSavedCount: number;
  hasReachedThreeItems: boolean;
  hasOfferedPlanWeek: boolean;
  hasScheduledItem: boolean;
  hasViewedCalendar: boolean;
  isCompleted: boolean;
  completedAt?: string;
  choice?: 'plan_week' | 'manual' | null;
  isDismissed: boolean;
}

const ACTIVATION_STORAGE_KEY = 'curatecal_activation_state_v1';
const ONBOARDING_COMPLETED_KEY = 'curatecal_first_activation_completed_v1';

/**
 * Returns true strictly if this is a brand new user who has never finished or dismissed
 * the first-use activation flow.
 */
export function isFirstUseActivationActive(): boolean {
  try {
    const permanentlyCompleted = localStorage.getItem(ONBOARDING_COMPLETED_KEY);
    if (permanentlyCompleted === 'true') {
      return false;
    }
    const state = getActivationState();
    if (state.isCompleted || state.isDismissed || state.hasScheduledItem) {
      markActivationPermanentlyCompleted();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Permanently marks first-use activation as completed so returning users never see it again.
 */
export function markActivationPermanentlyCompleted(): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
    const state = getActivationState();
    state.isCompleted = true;
    saveActivationState(state);
  } catch (err) {
    console.warn('[Activation] Failed to set permanent completion', err);
  }
}

export function getActivationState(): ActivationState {
  try {
    const raw = localStorage.getItem(ACTIVATION_STORAGE_KEY);
    if (!raw) {
      const initial: ActivationState = {
        startedAt: new Date().toISOString(),
        itemsSavedCount: 0,
        hasReachedThreeItems: false,
        hasOfferedPlanWeek: false,
        hasScheduledItem: false,
        hasViewedCalendar: false,
        isCompleted: false,
        choice: null,
        isDismissed: false,
      };
      localStorage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return JSON.parse(raw);
  } catch {
    return {
      startedAt: new Date().toISOString(),
      itemsSavedCount: 0,
      hasReachedThreeItems: false,
      hasOfferedPlanWeek: false,
      hasScheduledItem: false,
      hasViewedCalendar: false,
      isCompleted: false,
      choice: null,
      isDismissed: false,
    };
  }
}

export function saveActivationState(state: ActivationState): void {
  try {
    localStorage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(state));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curate:activation_updated', { detail: state }));
    }
  } catch (err) {
    console.warn('[Activation] Failed to save state:', err);
  }
}

function checkMilestoneCompletion(state: ActivationState): ActivationState {
  if (
    state.hasReachedThreeItems &&
    state.hasScheduledItem &&
    state.hasViewedCalendar &&
    !state.isCompleted
  ) {
    state.isCompleted = true;
    state.completedAt = new Date().toISOString();
    const durationSeconds = Math.round(
      (Date.now() - new Date(state.startedAt).getTime()) / 1000
    );

    trackEvent('activation_milestone_completed', {
      durationSeconds,
      itemsSavedCount: state.itemsSavedCount,
      choice: state.choice,
    });

    trackEvent('activation_milestone', {
      seconds_since_open: getSecondsSinceOpen(),
    });
  }
  return state;
}

/**
 * Checks whether an item counts as a genuine user-saved item (not a sample item and not completed).
 */
export function isUserSavedItem(item: { isSample?: boolean; status?: string }): boolean {
  return !item.isSample && item.status !== 'completed';
}

/**
 * Counts user-saved items, excluding sample items and completed items.
 */
export function countUserSavedItems(items: Array<{ isSample?: boolean; status?: string }>): number {
  return items.filter(isUserSavedItem).length;
}

/**
 * Record an item save and return the current progress (e.g. 1, 2, or 3).
 * Sample items (isSample: true) NEVER count toward 3-5-1 activation.
 */
export function recordActivationSave(
  totalActiveCount: number,
  itemTitle?: string,
  contentType?: string,
  isSample?: boolean
): { count: number; progressText: string; isReadyToPlan: boolean } {
  const state = getActivationState();

  // Guard: Sample items never count toward activation progress
  if (isSample) {
    return {
      count: state.itemsSavedCount,
      progressText: `${state.itemsSavedCount} of 3`,
      isReadyToPlan: state.hasReachedThreeItems && !state.hasScheduledItem && !state.isDismissed,
    };
  }

  const count = Math.min(3, Math.max(state.itemsSavedCount + 1, totalActiveCount));
  state.itemsSavedCount = count;

  const progressText = `${count} of 3`;

  trackEvent('activation_item_saved', {
    savedCount: count,
    targetCount: 3,
    progress: progressText,
    contentType,
  });

  trackEvent('activation_progress_updated', {
    progress: progressText,
    count,
    target: 3,
  });

  let isReadyToPlan = false;
  if (count >= 3) {
    state.hasReachedThreeItems = true;
    if (!state.hasOfferedPlanWeek) {
      state.hasOfferedPlanWeek = true;
      trackEvent('activation_offer_presented', {
        totalSaved: count,
      });
    }
    isReadyToPlan = !state.hasScheduledItem && !state.isDismissed;
  }

  saveActivationState(checkMilestoneCompletion(state));
  return { count, progressText, isReadyToPlan };
}

/**
 * Record when at least one item is scheduled.
 * Sample items (isSample: true) NEVER count toward 3-5-1 activation.
 */
export function recordActivationScheduled(
  itemId?: string,
  date?: string,
  title?: string,
  isSample?: boolean
): void {
  // Guard: Sample items never count toward activation
  if (isSample) return;

  const state = getActivationState();
  if (!state.hasScheduledItem) {
    state.hasScheduledItem = true;
    trackEvent('activation_item_scheduled', {
      itemId,
      date,
      itemsSavedCount: state.itemsSavedCount,
    });
    saveActivationState(checkMilestoneCompletion(state));
  }
}

/**
 * Record when the user views the calendar
 */
export function recordActivationCalendarViewed(source: 'nav' | 'plan_my_week' | 'direct' = 'nav'): void {
  const state = getActivationState();
  if (!state.hasViewedCalendar) {
    state.hasViewedCalendar = true;
    trackEvent('activation_calendar_viewed', {
      source,
      hasScheduledItem: state.hasScheduledItem,
      itemsSavedCount: state.itemsSavedCount,
    });
    saveActivationState(checkMilestoneCompletion(state));
  }
}

/**
 * Record the user choosing "Plan my week"
 */
export function recordActivationPlanMyWeek(itemsScheduledCount: number): void {
  const state = getActivationState();
  state.choice = 'plan_week';
  state.hasScheduledItem = true;
  state.hasViewedCalendar = true;

  try {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
  } catch {}

  trackEvent('activation_plan_my_week_clicked', {
    itemsScheduledCount,
    itemsSavedCount: state.itemsSavedCount,
  });

  saveActivationState(checkMilestoneCompletion(state));
}

/**
 * Record the user choosing "I'll do it manually"
 */
export function recordActivationManualChosen(): void {
  const state = getActivationState();
  state.choice = 'manual';
  state.isDismissed = true;

  try {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
  } catch {}

  trackEvent('activation_manual_chosen', {
    itemsSavedCount: state.itemsSavedCount,
    hasScheduledItem: state.hasScheduledItem,
    hasViewedCalendar: state.hasViewedCalendar,
  });

  saveActivationState(checkMilestoneCompletion(state));
}
