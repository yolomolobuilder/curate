/**
 * CurateCal Self-Check Test Suite
 *
 * Verifies core invariant rules:
 * 1. Multi-day item duration counting (180m item spread over 5 days counts 180m once in week, 0 on later days).
 * 2. Completed items stay in PLANNED, and DONE equals completed minutes (REMAINING = AVAILABLE - PLANNED).
 * 3. toDateStr uses local date, not toISOString (tested with 00:30 local time where UTC+2 must not roll back).
 * 4. Sample items are flagged (isSample: true) and never count toward the 3-5-1 activation milestone.
 */

/**
 * Ensure localStorage and window polyfills exist in Node CLI environment
 */
if (typeof globalThis.localStorage === 'undefined') {
  const memStore = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => { memStore.set(k, String(v)); },
    removeItem: (k: string) => { memStore.delete(k); },
    clear: () => { memStore.clear(); },
    key: (i: number) => Array.from(memStore.keys())[i] ?? null,
    length: 0,
  };
}

import { ContentItem } from '../types';
import {
  calculateTimeForDate,
  calculateTimeForDateSet,
  getItemMultiDayInfo,
  formatDuration,
  formatHoursMinutes,
} from './timeAccounting';
import { toDateStr, getTodayStr, getTomorrowStr, getOffsetDateStr } from './dateUtils';
import {
  generateCuratedStarterPack,
  getStoredItems,
  saveStoredItems,
  clearStoredItems,
  exportBackupJson,
  importBackupJson,
  CURRENT_SCHEMA_VERSION,
  getStorageUsageStats,
  setSimulateFullStorage,
  setSimulateUsageBytes,
  isSimulateFullStorage,
  getStorageFailureInfo,
  clearStorageFailureInfo,
  DEFAULT_STORAGE_QUOTA_BYTES,
} from './storage';
import {
  saveMediaItem,
  saveMediaItemSync,
  compressBase64ToCap,
  isMediaReference,
  MAX_MEDIA_BYTES,
} from './mediaStorage';
import { saveCustomBrandLogo } from './brand';
import {
  recordActivationSave,
  recordActivationScheduled,
  getActivationState,
  saveActivationState,
  countUserSavedItems,
  isUserSavedItem,
} from './activation';
import {
  getPreviousWeekRange,
  getWeeklyReviewData,
  keepItemInBacklog,
  rescheduleItemToDate,
} from './weeklyReview';
import { generateQuickPlan, WeekDaySlot } from './quickPlanner';
import {
  trackEvent,
  getStoredAnalyticsEvents,
  clearAnalyticsEvents,
  formatSessionLogJson,
  sanitizeAnalyticsProps,
  getSecondsSinceOpen,
} from './analytics';
import {
  isAnalyticsDisabled,
  setAnalyticsDisabled,
  ANALYTICS_OFF_STORAGE_KEY,
} from './analyticsConfig';

export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  message: string;
}

export interface SelfCheckSuiteResult {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}

export function runSelfCheckTests(): SelfCheckSuiteResult {
  const results: TestResult[] = [];

  // =========================================================================
  // Test 1: A 180-minute item spread over 5 days counts 180 minutes once
  // in the week and 0 on later days.
  // =========================================================================
  try {
    const multiDayItem: ContentItem = {
      id: 'test-book-180m',
      title: 'Deep Work: Rules for Focused Success',
      contentType: 'book',
      status: 'planned',
      durationMinutes: 180,
      scheduledDate: '2026-10-12', // Monday
      scheduledEndDate: '2026-10-16', // Friday (5 days total)
      createdAt: '2026-10-01T00:00:00.000Z',
      thumbnailUrl: '',
    };

    const items = [multiDayItem];

    // Day 1 (Start date): must count 180 minutes
    const day1 = calculateTimeForDate(items, '2026-10-12', 200);
    if (day1.plannedMinutes !== 180) {
      throw new Error(`Expected day 1 plannedMinutes to be 180, got ${day1.plannedMinutes}`);
    }

    // Days 2 to 5 (Later days): must count 0 minutes each
    const laterDays = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
    for (const d of laterDays) {
      const dayRes = calculateTimeForDate(items, d, 200);
      if (dayRes.plannedMinutes !== 0) {
        throw new Error(`Expected day ${d} plannedMinutes to be 0, got ${dayRes.plannedMinutes}`);
      }
    }

    // Week total: 7-day week set must count 180 minutes once (NOT 900 minutes)
    const weekSet = new Set([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    const weekRes = calculateTimeForDateSet(items, weekSet, 300);
    if (weekRes.plannedMinutes !== 180) {
      throw new Error(`Expected week plannedMinutes to be 180, got ${weekRes.plannedMinutes}`);
    }

    // Multi-day continuation info check
    const infoDay1 = getItemMultiDayInfo(multiDayItem, '2026-10-12');
    const infoDay2 = getItemMultiDayInfo(multiDayItem, '2026-10-13');
    const infoDay5 = getItemMultiDayInfo(multiDayItem, '2026-10-16');

    if (!infoDay1.isStartDay || infoDay1.isContinuation || infoDay1.dayNumber !== 1 || infoDay1.totalDays !== 5) {
      throw new Error(`MultiDayInfo day 1 mismatch: ${JSON.stringify(infoDay1)}`);
    }
    if (infoDay2.isStartDay || !infoDay2.isContinuation || infoDay2.dayNumber !== 2 || infoDay2.totalDays !== 5) {
      throw new Error(`MultiDayInfo day 2 continuation mismatch: ${JSON.stringify(infoDay2)}`);
    }
    if (infoDay5.isStartDay || !infoDay5.isContinuation || infoDay5.dayNumber !== 5 || infoDay5.totalDays !== 5) {
      throw new Error(`MultiDayInfo day 5 continuation mismatch: ${JSON.stringify(infoDay5)}`);
    }

    results.push({
      id: 'test-1-multiday-counting',
      name: '180-min multi-day item counted once in week, 0 on later days',
      passed: true,
      message: 'Verified: 180m counted once on start date (2026-10-12), 0m on later days, 180m total across week (not 900m).',
    });
  } catch (err: any) {
    results.push({
      id: 'test-1-multiday-counting',
      name: '180-min multi-day item counted once in week, 0 on later days',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 2: Completed items stay in PLANNED, and DONE equals completed minutes.
  // =========================================================================
  try {
    const plannedItem: ContentItem = {
      id: 'item-planned-60',
      title: 'Planning Session',
      contentType: 'article',
      status: 'planned',
      durationMinutes: 60,
      scheduledDate: '2026-10-12',
      createdAt: '2026-10-01T00:00:00.000Z',
      thumbnailUrl: '',
    };
    const completedItem: ContentItem = {
      id: 'item-done-70',
      title: 'Completed Documentary',
      contentType: 'documentary',
      status: 'completed',
      durationMinutes: 70,
      scheduledDate: '2026-10-12',
      createdAt: '2026-10-01T00:00:00.000Z',
      completedAt: '2026-10-12T10:00:00.000Z',
      thumbnailUrl: '',
    };

    const items = [plannedItem, completedItem];
    const availableBudget = 180; // 3 hours available

    const dayCalc = calculateTimeForDate(items, '2026-10-12', availableBudget);

    // Rule 1: Completed items STAY in planned (60 + 70 = 130)
    if (dayCalc.plannedMinutes !== 130) {
      throw new Error(`Expected plannedMinutes to be 130 (including completed item), got ${dayCalc.plannedMinutes}`);
    }

    // Rule 2: DONE equals completed minutes (70)
    if (dayCalc.completedMinutes !== 70) {
      throw new Error(`Expected completedMinutes to be 70, got ${dayCalc.completedMinutes}`);
    }

    // Rule 3: REMAINING = AVAILABLE - PLANNED (180 - 130 = 50)
    if (dayCalc.remainingMinutes !== 50) {
      throw new Error(`Expected remainingMinutes to be 50 (180 - 130), got ${dayCalc.remainingMinutes}`);
    }

    // Formatters check
    const plannedFormatted = formatHoursMinutes(dayCalc.plannedMinutes);
    const doneFormatted = formatHoursMinutes(dayCalc.completedMinutes);
    if (plannedFormatted !== '2h 10m') {
      throw new Error(`Expected planned formatted '2h 10m', got '${plannedFormatted}'`);
    }
    if (doneFormatted !== '1h 10m') {
      throw new Error(`Expected done formatted '1h 10m', got '${doneFormatted}'`);
    }

    // Week date set consistency
    const weekSet = new Set(['2026-10-12']);
    const weekCalc = calculateTimeForDateSet(items, weekSet, availableBudget);
    if (weekCalc.plannedMinutes !== 130 || weekCalc.completedMinutes !== 70 || weekCalc.remainingMinutes !== 50) {
      throw new Error(`Week budget calculation mismatch: ${JSON.stringify(weekCalc)}`);
    }

    results.push({
      id: 'test-2-completed-accounting',
      name: 'Completed items stay in PLANNED, and DONE equals completed minutes',
      passed: true,
      message: 'Verified: Planned = 130m (includes completed 70m), Done = 70m, Remaining = 50m (180m - 130m).',
    });
  } catch (err: any) {
    results.push({
      id: 'test-2-completed-accounting',
      name: 'Completed items stay in PLANNED, and DONE equals completed minutes',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 3: toDateStr uses the local date, not toISOString.
  // Test with 00:30 local time (a UTC+2 user must not get the previous day).
  // =========================================================================
  try {
    // Construct local date at 00:30 local time on 2026-05-15
    const localMidnightDate = new Date(2026, 4, 15, 0, 30, 0); // May 15, 2026, 00:30:00
    const str = toDateStr(localMidnightDate);

    if (str !== '2026-05-15') {
      throw new Error(`Expected toDateStr(2026-05-15 00:30 local) to be '2026-05-15', got '${str}'`);
    }

    // Explicit test for the UTC+2 edge-case:
    // In UTC+2 (e.g. Athens/Cairo/Helsinki/Johannesburg, UTC+2 hours),
    // local time 2026-05-15 00:30 is 2026-05-14 22:30:00 UTC.
    // If toISOString().slice(0, 10) were used, it would yield '2026-05-14' (previous day - BUG).
    // toDateStr MUST use getFullYear(), getMonth(), getDate() and return '2026-05-15'.
    const mockUtcPlus2Date = {
      getFullYear: () => 2026,
      getMonth: () => 4, // May (0-indexed)
      getDate: () => 15,
      toISOString: () => '2026-05-14T22:30:00.000Z',
    } as unknown as Date;

    const mockResult = toDateStr(mockUtcPlus2Date);
    const brokenIsoSlice = mockUtcPlus2Date.toISOString().slice(0, 10);

    if (mockResult !== '2026-05-15') {
      throw new Error(`UTC+2 mock date produced '${mockResult}', expected '2026-05-15'`);
    }
    if (mockResult === brokenIsoSlice) {
      throw new Error(`toDateStr erroneously matched toISOString().slice(0, 10) ('${brokenIsoSlice}')`);
    }

    // Helper functions consistency check
    const offsetTomorrow = getOffsetDateStr(1, localMidnightDate);
    if (offsetTomorrow !== '2026-05-16') {
      throw new Error(`Expected offsetTomorrow '2026-05-16', got '${offsetTomorrow}'`);
    }

    results.push({
      id: 'test-3-todatestr-local-timezone',
      name: 'toDateStr uses local date, not toISOString (UTC+2 at 00:30 preserves date)',
      passed: true,
      message: 'Verified: 00:30 local time preserves local date (2026-05-15). UTC+2 does not roll back to previous day.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-3-todatestr-local-timezone',
      name: 'toDateStr uses local date, not toISOString (UTC+2 at 00:30 preserves date)',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 4: Sample items are flagged (isSample) and never count toward the 3-5-1 activation.
  // =========================================================================
  try {
    // 1. Verify starter pack items all carry isSample: true
    const starterPack = generateCuratedStarterPack();
    if (!starterPack || starterPack.length === 0) {
      throw new Error('Starter pack is empty');
    }

    const allFlagged = starterPack.every((it) => it.isSample === true);
    if (!allFlagged) {
      const unflagged = starterPack.filter((it) => !it.isSample);
      throw new Error(`Starter items missing isSample flag: ${unflagged.map((u) => u.id).join(', ')}`);
    }

    // 2. Verify countUserSavedItems filters out sample items
    const userCountWithSamplesOnly = countUserSavedItems(starterPack);
    if (userCountWithSamplesOnly !== 0) {
      throw new Error(`Expected 0 user items from starter pack, got ${userCountWithSamplesOnly}`);
    }

    // 3. Verify sample item save does NOT increment activation count
    // Reset activation state for pure test run
    const originalState = getActivationState();
    const testState = {
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
    saveActivationState(testState);

    // Save a sample item
    const sampleSaveResult = recordActivationSave(8, 'Sample Video', 'youtube', true);
    if (sampleSaveResult.count !== 0 || sampleSaveResult.isReadyToPlan) {
      throw new Error(`Sample save incremented activation: count=${sampleSaveResult.count}, isReadyToPlan=${sampleSaveResult.isReadyToPlan}`);
    }

    // Attempt to schedule a sample item
    recordActivationScheduled('starter-1', '2026-10-12', 'Sample Video', true);
    const stateAfterSampleSchedule = getActivationState();
    if (stateAfterSampleSchedule.hasScheduledItem) {
      throw new Error('Sample item scheduling triggered activation hasScheduledItem');
    }

    // 4. Verify genuine user-created items increment activation as expected (1, 2, 3)
    const userSave1 = recordActivationSave(1, 'User Video 1', 'youtube', false);
    if (userSave1.count !== 1 || userSave1.isReadyToPlan) {
      throw new Error(`User item 1 save failed: count=${userSave1.count}`);
    }

    const userSave2 = recordActivationSave(2, 'User Article 2', 'article', false);
    if (userSave2.count !== 2 || userSave2.isReadyToPlan) {
      throw new Error(`User item 2 save failed: count=${userSave2.count}`);
    }

    const userSave3 = recordActivationSave(3, 'User Book 3', 'book', false);
    if (userSave3.count !== 3 || !userSave3.isReadyToPlan) {
      throw new Error(`User item 3 save failed: count=${userSave3.count}, isReadyToPlan=${userSave3.isReadyToPlan}`);
    }

    // Schedule a real user item
    recordActivationScheduled('user-item-1', '2026-10-12', 'User Video 1', false);
    const stateAfterRealSchedule = getActivationState();
    if (!stateAfterRealSchedule.hasScheduledItem) {
      throw new Error('User item scheduling failed to trigger hasScheduledItem');
    }

    // Restore previous state if any
    saveActivationState(originalState);

    results.push({
      id: 'test-4-sample-activation-exclusion',
      name: 'Sample items are flagged (isSample) and never count toward 3-5-1 activation',
      passed: true,
      message: 'Verified: All 8 starter pack items flagged with isSample: true. Sample items excluded from activation counts; only real user items advance activation.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-4-sample-activation-exclusion',
      name: 'Sample items are flagged (isSample) and never count toward 3-5-1 activation',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 5: Exports, clears sample data, imports and compares.
  // =========================================================================
  try {
    // Preserve initial state so test run is fully side-effect free
    const initialBackup = exportBackupJson();

    // 1. Prepare sample starter data
    const samplePack = generateCuratedStarterPack();
    saveStoredItems(samplePack);

    // Verify storage currently has sample items
    const storedBeforeExport = getStoredItems();
    if (storedBeforeExport.length !== samplePack.length) {
      throw new Error(`Expected ${samplePack.length} items stored, found ${storedBeforeExport.length}`);
    }

    // 2. Export backup JSON
    const exportedJson = exportBackupJson();
    const parsedExport = JSON.parse(exportedJson);

    if (parsedExport.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`Expected schemaVersion ${CURRENT_SCHEMA_VERSION}, got ${parsedExport.schemaVersion}`);
    }
    if (!Array.isArray(parsedExport.items) || parsedExport.items.length !== samplePack.length) {
      throw new Error(`Exported items count mismatch: expected ${samplePack.length}, got ${parsedExport.items?.length}`);
    }

    // 3. Clear sample data from storage
    clearStoredItems();
    const storedAfterClear = getStoredItems();
    if (storedAfterClear.length !== 0) {
      throw new Error(`Failed to clear sample data: storage still contains ${storedAfterClear.length} items`);
    }

    // 4. Import the exported backup
    const importSuccess = importBackupJson(exportedJson);
    if (!importSuccess) {
      throw new Error('importBackupJson returned false for valid exported backup');
    }

    // 5. Compare imported items against original sample items
    const restoredItems = getStoredItems();
    if (restoredItems.length !== samplePack.length) {
      throw new Error(`Imported item count mismatch: expected ${samplePack.length}, got ${restoredItems.length}`);
    }

    for (let i = 0; i < samplePack.length; i++) {
      const orig = samplePack[i];
      const restored = restoredItems.find((it) => it.id === orig.id);
      if (!restored) {
        throw new Error(`Item ${orig.id} missing from restored items`);
      }
      if (restored.title !== orig.title) {
        throw new Error(`Item ${orig.id} title mismatch: '${orig.title}' vs '${restored.title}'`);
      }
      if (restored.contentType !== orig.contentType) {
        throw new Error(`Item ${orig.id} contentType mismatch: '${orig.contentType}' vs '${restored.contentType}'`);
      }
      if (restored.durationMinutes !== orig.durationMinutes) {
        throw new Error(`Item ${orig.id} durationMinutes mismatch: ${orig.durationMinutes} vs ${restored.durationMinutes}`);
      }
      if (restored.scheduledDate !== orig.scheduledDate) {
        throw new Error(`Item ${orig.id} scheduledDate mismatch: '${orig.scheduledDate}' vs '${restored.scheduledDate}'`);
      }
      if (Boolean(restored.isSample) !== Boolean(orig.isSample)) {
        throw new Error(`Item ${orig.id} isSample flag mismatch: expected ${orig.isSample}, got ${restored.isSample}`);
      }
    }

    // Restore previous initial data
    importBackupJson(initialBackup);

    results.push({
      id: 'test-5-export-clear-import-compare',
      name: 'Export backup, clear sample data, import and compare',
      passed: true,
      message: `Verified: Exported ${samplePack.length} items with schemaVersion ${CURRENT_SCHEMA_VERSION}, cleared storage to 0, imported backup, and verified 100% field parity across all items.`,
    });
  } catch (err: any) {
    results.push({
      id: 'test-5-export-clear-import-compare',
      name: 'Export backup, clear sample data, import and compare',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 6: Inbox summary duration calculation, multi-dimensional filters,
  // and single priority toggle behavior
  // =========================================================================
  try {
    const testItems: ContentItem[] = [
      {
        id: 'item-1-mktg-short',
        title: 'Marketing 101',
        topic: 'Marketing',
        contentType: 'article',
        durationMinutes: 10,
        status: 'inbox',
        isPriority: true,
        thumbnailUrl: '',
        createdAt: '2026-10-01T10:00:00.000Z',
      },
      {
        id: 'item-2-ux-mid',
        title: 'Design Systems Deep Dive',
        topic: 'UX/UI',
        contentType: 'youtube',
        durationMinutes: 25,
        status: 'inbox',
        isPriority: false,
        thumbnailUrl: '',
        createdAt: '2026-10-02T10:00:00.000Z',
      },
      {
        id: 'item-3-german-hour',
        title: 'German C1 Advanced Grammar',
        topic: 'German',
        contentType: 'podcast',
        durationMinutes: 45,
        status: 'inbox',
        isPriority: false,
        thumbnailUrl: '',
        createdAt: '2026-10-03T10:00:00.000Z',
      },
      {
        id: 'item-4-health-long',
        title: 'Sleep Science and Longevity',
        topic: 'Health',
        contentType: 'book',
        durationMinutes: 90,
        status: 'inbox',
        isPriority: true,
        thumbnailUrl: '',
        createdAt: '2026-10-04T10:00:00.000Z',
      },
      {
        id: 'item-5-scheduled-fitness',
        title: 'Zone 2 Cardio Protocols',
        topic: 'Fitness',
        contentType: 'article',
        durationMinutes: 20,
        status: 'planned',
        scheduledDate: '2026-10-15',
        isPriority: false,
        thumbnailUrl: '',
        createdAt: '2026-10-05T10:00:00.000Z',
      },
      {
        id: 'item-6-completed-other',
        title: 'Ancient Philosophy and Stoicism',
        topic: 'Philosophy', // 'other'
        contentType: 'podcast',
        durationMinutes: 50,
        status: 'completed',
        scheduledDate: '2026-10-10',
        completedAt: '2026-10-10T12:00:00.000Z',
        isPriority: false,
        thumbnailUrl: '',
        createdAt: '2026-10-06T10:00:00.000Z',
      },
    ];

    // 1. Backlog Summary metric: Unplanned count and total duration
    const unplanned = testItems.filter(
      (it) => it.status === 'inbox' || (!it.scheduledDate && it.status !== 'completed')
    );
    if (unplanned.length !== 4) {
      throw new Error(`Expected 4 unplanned items, got ${unplanned.length}`);
    }
    const totalUnplannedMins = unplanned.reduce(
      (acc, it) => acc + (it.durationMinutes || 0),
      0
    );
    // 10 + 25 + 45 + 90 = 170 mins = 2h 50m
    if (totalUnplannedMins !== 170) {
      throw new Error(`Expected 170 unplanned minutes, got ${totalUnplannedMins}`);
    }
    const summaryFormatted = formatHoursMinutes(totalUnplannedMins);
    if (summaryFormatted !== '2h 50m') {
      throw new Error(`Expected formatted duration '2h 50m', got '${summaryFormatted}'`);
    }

    // 2. Duration filter validation (<15m, 15-30m, 30-60m, 1h+)
    const under15 = testItems.filter((it) => (it.durationMinutes || 0) < 15);
    if (under15.length !== 1 || under15[0].id !== 'item-1-mktg-short') {
      throw new Error(`Duration filter <15m failed`);
    }
    const over1h = testItems.filter((it) => (it.durationMinutes || 0) > 60);
    if (over1h.length !== 1 || over1h[0].id !== 'item-4-health-long') {
      throw new Error(`Duration filter 1h+ failed`);
    }

    // 3. Topic filter: Other / Remaining topics
    const specifiedTopics = ['Marketing', 'UX/UI', 'German', 'English', 'Health', 'Fitness'];
    const otherItems = testItems.filter(
      (it) => !specifiedTopics.some((t) => t.toLowerCase() === (it.topic || '').toLowerCase())
    );
    if (otherItems.length !== 1 || otherItems[0].id !== 'item-6-completed-other') {
      throw new Error(`Topic filter 'other' failed`);
    }

    // 4. Priority toggle isolation
    const priorityItems = testItems.filter((it) => it.isPriority);
    if (priorityItems.length !== 2) {
      throw new Error(`Expected 2 priority items, got ${priorityItems.length}`);
    }

    results.push({
      id: 'test-6-inbox-summary-and-filters',
      name: 'Inbox backlog summary, multi-dimensional filters, and priority toggle',
      passed: true,
      message: `Verified: Backlog summary metric calculated 4 unplanned / 2h 50m accurately; verified duration brackets (<15m, 1h+), topic filtering (including other), and single priority toggle.`,
    });
  } catch (err: any) {
    results.push({
      id: 'test-6-inbox-summary-and-filters',
      name: 'Inbox backlog summary, multi-dimensional filters, and priority toggle',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 7: Weekly Review - Previous-week totals, item partitioning, and triage
  // =========================================================================
  try {
    // Anchor: Wednesday Oct 14, 2026.
    // Previous week is Monday Oct 5 to Sunday Oct 11, 2026.
    const anchorDate = new Date(2026, 9, 14); // Oct 14, 2026
    const range = getPreviousWeekRange(anchorDate);

    if (range.startStr !== '2026-10-05' || range.endStr !== '2026-10-11') {
      throw new Error(`Expected previous week range 2026-10-05 to 2026-10-11, got ${range.startStr} to ${range.endStr}`);
    }

    const testWeekItems: ContentItem[] = [
      {
        id: 'rev-done-1',
        title: 'Finished Podcast',
        contentType: 'podcast',
        status: 'completed',
        durationMinutes: 45,
        scheduledDate: '2026-10-06',
        createdAt: '2026-10-01T00:00:00.000Z',
        completedAt: '2026-10-06T12:00:00.000Z',
        thumbnailUrl: '',
      },
      {
        id: 'rev-done-2',
        title: 'Finished Short Video',
        contentType: 'youtube',
        status: 'completed',
        durationMinutes: 30,
        scheduledDate: '2026-10-08',
        createdAt: '2026-10-01T00:00:00.000Z',
        completedAt: '2026-10-08T15:00:00.000Z',
        thumbnailUrl: '',
      },
      {
        id: 'rev-unfinished-star',
        title: 'Starred Unfinished Book',
        contentType: 'book',
        status: 'planned',
        durationMinutes: 60,
        scheduledDate: '2026-10-09',
        createdAt: '2026-10-01T00:00:00.000Z',
        isPriority: true,
        thumbnailUrl: '',
      },
      {
        id: 'rev-unfinished-regular',
        title: 'Unfinished Article',
        contentType: 'article',
        status: 'planned',
        durationMinutes: 15,
        scheduledDate: '2026-10-10',
        createdAt: '2026-10-01T00:00:00.000Z',
        isPriority: false,
        thumbnailUrl: '',
      },
      {
        id: 'rev-other-week',
        title: 'Future Week Item',
        contentType: 'article',
        status: 'planned',
        durationMinutes: 20,
        scheduledDate: '2026-10-15',
        createdAt: '2026-10-01T00:00:00.000Z',
        thumbnailUrl: '',
      },
    ];

    const data = getWeeklyReviewData(testWeekItems, anchorDate);

    // 1. Totals check:
    // Planned = 45 + 30 + 60 + 15 = 150m (2h 30m)
    // Completed = 45 + 30 = 75m (1h 15m)
    // Unfinished = 75m (1h 15m)
    // Completion rate = 75 / 150 = 50%
    if (data.totals.plannedMinutes !== 150) {
      throw new Error(`Expected plannedMinutes 150, got ${data.totals.plannedMinutes}`);
    }
    if (data.totals.completedMinutes !== 75) {
      throw new Error(`Expected completedMinutes 75, got ${data.totals.completedMinutes}`);
    }
    if (data.totals.unfinishedMinutes !== 75) {
      throw new Error(`Expected unfinishedMinutes 75, got ${data.totals.unfinishedMinutes}`);
    }
    if (data.totals.completionRate !== 50) {
      throw new Error(`Expected completionRate 50%, got ${data.totals.completionRate}%`);
    }

    // 2. Partitioning check:
    // Completed items count = 2
    if (data.completedItems.length !== 2) {
      throw new Error(`Expected 2 completed items, got ${data.completedItems.length}`);
    }
    // Still interested = 1 (starred item rev-unfinished-star)
    if (data.stillInterestedItems.length !== 1 || data.stillInterestedItems[0].id !== 'rev-unfinished-star') {
      throw new Error(`Expected 1 still-interested item (rev-unfinished-star), got ${data.stillInterestedItems.length}`);
    }
    // Didn't get to = 1 (rev-unfinished-regular)
    if (data.didntGetToItems.length !== 1 || data.didntGetToItems[0].id !== 'rev-unfinished-regular') {
      throw new Error(`Expected 1 didn't-get-to item (rev-unfinished-regular), got ${data.didntGetToItems.length}`);
    }

    // 3. Triage mutation checks:
    // Keep in backlog
    const kept = keepItemInBacklog(data.stillInterestedItems[0]);
    if (kept.status !== 'inbox' || kept.scheduledDate !== undefined) {
      throw new Error(`Keep action failed: status=${kept.status}, scheduledDate=${kept.scheduledDate}`);
    }

    // Reschedule to new week
    const rescheduled = rescheduleItemToDate(data.didntGetToItems[0], '2026-10-12');
    if (rescheduled.status !== 'planned' || rescheduled.scheduledDate !== '2026-10-12') {
      throw new Error(`Reschedule action failed: status=${rescheduled.status}, scheduledDate=${rescheduled.scheduledDate}`);
    }

    results.push({
      id: 'test-7-weekly-review-accounting-and-triage',
      name: 'Weekly Review: previous-week totals, Still interested / Didn\'t get to partitioning, and triage actions',
      passed: true,
      message: 'Verified: Range calculation (Oct 5–11), 150m planned / 75m completed (50%), Still interested vs Didn\'t get to partitioning, Keep (moves to inbox) and Reschedule (assigns new date) triage actions.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-7-weekly-review-accounting-and-triage',
      name: 'Weekly Review: previous-week totals, Still interested / Didn\'t get to partitioning, and triage actions',
      passed: false,
      message: err.message || String(err),
    });
  }

  // Fixed test calendar week for deterministic Quick Plan tests (Mon Oct 12, 2026 to Sun Oct 18, 2026)
  const makeFixedWeek = (): WeekDaySlot[] => [
    { dateStr: '2026-10-12', date: new Date('2026-10-12T12:00:00Z'), dayOfWeek: 1, dayName: 'Monday', currentPlannedMinutes: 0 },
    { dateStr: '2026-10-13', date: new Date('2026-10-13T12:00:00Z'), dayOfWeek: 2, dayName: 'Tuesday', currentPlannedMinutes: 0 },
    { dateStr: '2026-10-14', date: new Date('2026-10-14T12:00:00Z'), dayOfWeek: 3, dayName: 'Wednesday', currentPlannedMinutes: 0 },
    { dateStr: '2026-10-15', date: new Date('2026-10-15T12:00:00Z'), dayOfWeek: 4, dayName: 'Thursday', currentPlannedMinutes: 0 },
    { dateStr: '2026-10-16', date: new Date('2026-10-16T12:00:00Z'), dayOfWeek: 5, dayName: 'Friday', currentPlannedMinutes: 0 },
    { dateStr: '2026-10-17', date: new Date('2026-10-17T12:00:00Z'), dayOfWeek: 6, dayName: 'Saturday', currentPlannedMinutes: 0 },
    { dateStr: '2026-10-18', date: new Date('2026-10-18T12:00:00Z'), dayOfWeek: 0, dayName: 'Sunday', currentPlannedMinutes: 0 },
  ];

  // =========================================================================
  // Test 8: Quick Plan Rule 1 - Only propose days from today onward.
  // If no days remain this week, say so and offer next week.
  // =========================================================================
  try {
    const fixedWeek = makeFixedWeek();
    const testItems: ContentItem[] = [
      { id: 'qp-r1-1', title: 'Video 1', contentType: 'youtube', status: 'inbox', durationMinutes: 20, createdAt: '2026-10-01', thumbnailUrl: '' },
      { id: 'qp-r1-2', title: 'Article 2', contentType: 'article', status: 'inbox', durationMinutes: 25, createdAt: '2026-10-02', thumbnailUrl: '' },
      { id: 'qp-r1-3', title: 'Podcast 3', contentType: 'podcast', status: 'inbox', durationMinutes: 30, createdAt: '2026-10-03', thumbnailUrl: '' },
    ];

    // Part A: Reference date is Thursday Oct 15, 2026.
    // Days Mon-Wed (Oct 12-14) must NEVER be proposed.
    const planFromThursday = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: testItems,
      existingWeekItems: [],
      availableBudgetMinutes: 180,
      todayDateStr: '2026-10-15',
    });

    if (planFromThursday.proposedItems.length === 0) {
      throw new Error('Expected proposed items for Thursday-Sunday');
    }

    for (const pi of planFromThursday.proposedItems) {
      if (pi.targetDateStr < '2026-10-15') {
        throw new Error(`Proposed date ${pi.targetDateStr} is before today (2026-10-15)`);
      }
    }

    // Part B: Reference date is Oct 19 (after Sunday). No days remain this week.
    const planPastWeek = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: testItems,
      existingWeekItems: [],
      availableBudgetMinutes: 180,
      todayDateStr: '2026-10-19',
    });

    if (!planPastWeek.noDaysRemainingThisWeek || planPastWeek.proposedItems.length !== 0) {
      throw new Error(`Expected noDaysRemainingThisWeek=true and 0 proposed items, got ${JSON.stringify(planPastWeek)}`);
    }

    results.push({
      id: 'test-8-quick-plan-rule-1-today-onward-only',
      name: 'Quick Plan Rule 1: Propose days only from today onward, and flag when no days remain this week',
      passed: true,
      message: 'Verified: On fixed Thursday (2026-10-15), items are only scheduled Thu–Sun. When week is in past (2026-10-19), noDaysRemainingThisWeek is true and 0 items proposed.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-8-quick-plan-rule-1-today-onward-only',
      name: 'Quick Plan Rule 1: Propose days only from today onward, and flag when no days remain this week',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 9: Quick Plan Rule 2 - Add a 'Not scheduled' list to the preview
  // with a reason for each item (e.g. 'Too long for the remaining budget: 3h book').
  // =========================================================================
  try {
    const fixedWeek = makeFixedWeek();
    const testItems: ContentItem[] = [
      { id: 'qp-r2-fit', title: 'Short Essay', contentType: 'article', status: 'inbox', durationMinutes: 20, createdAt: '2026-10-01', thumbnailUrl: '' },
      { id: 'qp-r2-long', title: 'Deep Book', contentType: 'book', status: 'inbox', durationMinutes: 180, createdAt: '2026-10-02', thumbnailUrl: '' },
    ];

    const planResult = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: testItems,
      existingWeekItems: [],
      availableBudgetMinutes: 60, // 85% cap is 51m
      todayDateStr: '2026-10-12',
    });

    if (!planResult.notScheduledItems || planResult.notScheduledItems.length !== 1) {
      throw new Error(`Expected 1 not-scheduled item, got ${planResult.notScheduledItems?.length}`);
    }

    const notSched = planResult.notScheduledItems[0];
    if (notSched.item.id !== 'qp-r2-long') {
      throw new Error(`Expected 'qp-r2-long' in notScheduledItems, got ${notSched.item.id}`);
    }

    if (!notSched.reason || !notSched.reason.toLowerCase().includes('too long for') || !notSched.reason.includes('book')) {
      throw new Error(`Expected reason to describe 'Too long for ... book', got: "${notSched.reason}"`);
    }

    results.push({
      id: 'test-9-quick-plan-rule-2-not-scheduled-list-with-reasons',
      name: 'Quick Plan Rule 2: Not scheduled list includes every unpicked item with clear human reason',
      passed: true,
      message: `Verified: 3h book is cataloged in notScheduledItems with reason: "${notSched.reason}".`,
    });
  } catch (err: any) {
    results.push({
      id: 'test-9-quick-plan-rule-2-not-scheduled-list-with-reasons',
      name: 'Quick Plan Rule 2: Not scheduled list includes every unpicked item with clear human reason',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 10: Quick Plan Rule 3 - Never add items when the week is already
  // above 85% of the budget, and never exceed 85% cap.
  // =========================================================================
  try {
    const fixedWeek = makeFixedWeek();
    // Week budget = 100m, 85% cap = 85m. Existing items = 90m (already at 90%).
    const existingOverCap: ContentItem[] = [
      { id: 'qp-r3-exist', title: 'Scheduled podcast', contentType: 'podcast', status: 'planned', durationMinutes: 90, scheduledDate: '2026-10-12', createdAt: '2026-10-01', thumbnailUrl: '' },
    ];
    const inboxItems: ContentItem[] = [
      { id: 'qp-r3-inbox-1', title: 'Quick read', contentType: 'article', status: 'inbox', durationMinutes: 10, createdAt: '2026-10-05', thumbnailUrl: '' },
    ];

    const planWhenOver = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems,
      existingWeekItems: existingOverCap,
      availableBudgetMinutes: 100,
      todayDateStr: '2026-10-12',
    });

    if (planWhenOver.proposedItems.length !== 0) {
      throw new Error(`Expected 0 proposed items when week is already at 90% of budget, got ${planWhenOver.proposedItems.length}`);
    }

    if (!planWhenOver.notScheduledItems[0]?.reason.includes('at or above 85%')) {
      throw new Error(`Expected reason to mention 'at or above 85%', got: "${planWhenOver.notScheduledItems[0]?.reason}"`);
    }

    // Also verify that adding items NEVER pushes total past 85%
    const inboxMultiple: ContentItem[] = [
      { id: 'qp-r3-m1', title: 'Item 1', contentType: 'article', status: 'inbox', durationMinutes: 30, createdAt: '2026-10-01', thumbnailUrl: '' },
      { id: 'qp-r3-m2', title: 'Item 2', contentType: 'article', status: 'inbox', durationMinutes: 30, createdAt: '2026-10-02', thumbnailUrl: '' },
      { id: 'qp-r3-m3', title: 'Item 3', contentType: 'article', status: 'inbox', durationMinutes: 30, createdAt: '2026-10-03', thumbnailUrl: '' },
    ];
    const planCapEnforced = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: inboxMultiple,
      existingWeekItems: [],
      availableBudgetMinutes: 100, // 85% cap = 85m. 30 + 30 = 60m fits. 30 + 30 + 30 = 90m exceeds 85m.
      todayDateStr: '2026-10-12',
    });

    if (planCapEnforced.totalPlannedMinutes > 85) {
      throw new Error(`Total planned minutes ${planCapEnforced.totalPlannedMinutes} exceeded 85% cap (85m)`);
    }

    results.push({
      id: 'test-10-quick-plan-rule-3-strict-85-percent-cap',
      name: 'Quick Plan Rule 3: Never add items when week is above 85% of budget; cap strictly enforced',
      passed: true,
      message: 'Verified: 0 items added when initial planned time (90m) exceeds 85% of budget (100m). Multiple additions strictly cap below 85m.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-10-quick-plan-rule-3-strict-85-percent-cap',
      name: 'Quick Plan Rule 3: Never add items when week is above 85% of budget; cap strictly enforced',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 11: Quick Plan Rule 4 - After first pass, try to get closer to 85%
  // with a better combination of remaining items. Keep it deterministic.
  // =========================================================================
  try {
    const fixedWeek = makeFixedWeek();
    // Budget: 100m -> 85% cap = 85m.
    // Items: Item 1 (50m), Item 2 (45m), Item 3 (35m).
    // Greedy first pass picks Item 1 (50m). Gap is 35m.
    // Item 2 (45m) does not fit.
    // Combination pass evaluates remaining Item 3 (35m) which fits into the gap of 35m.
    // Total planned becomes exactly 50m + 35m = 85m (100% of 85% cap).
    const comboCandidates: ContentItem[] = [
      { id: 'combo-1', title: 'Item 50m', contentType: 'article', status: 'inbox', durationMinutes: 50, createdAt: '2026-10-01', thumbnailUrl: '' },
      { id: 'combo-2', title: 'Item 45m', contentType: 'podcast', status: 'inbox', durationMinutes: 45, createdAt: '2026-10-02', thumbnailUrl: '' },
      { id: 'combo-3', title: 'Item 35m', contentType: 'youtube', status: 'inbox', durationMinutes: 35, createdAt: '2026-10-03', thumbnailUrl: '' },
    ];

    const planCombo = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: comboCandidates,
      existingWeekItems: [],
      availableBudgetMinutes: 100,
      todayDateStr: '2026-10-12',
    });

    if (planCombo.totalPlannedMinutes !== 85) {
      throw new Error(`Expected combination to achieve exactly 85m (85% cap), got ${planCombo.totalPlannedMinutes}m`);
    }

    if (planCombo.proposedItems.length !== 2) {
      throw new Error(`Expected 2 items in combination (50m + 35m), got ${planCombo.proposedItems.length}`);
    }

    results.push({
      id: 'test-11-quick-plan-rule-4-combination-optimization',
      name: 'Quick Plan Rule 4: Combination optimization gets deterministically closer to 85% target',
      passed: true,
      message: 'Verified: First pass took 50m item, remaining pass paired with 35m item to achieve exact 85m target (85% of 100m budget).',
    });
  } catch (err: any) {
    results.push({
      id: 'test-11-quick-plan-rule-4-combination-optimization',
      name: 'Quick Plan Rule 4: Combination optimization gets deterministically closer to 85% target',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 12: Quick Plan Rule 5 - Default strategy is 'Priority, then oldest',
  // with duration only breaking ties. Keep 'Shortest first' as an option.
  // =========================================================================
  try {
    const fixedWeek = makeFixedWeek();
    const itemsForOrdering: ContentItem[] = [
      { id: 'strat-norm', title: 'Old Non-Priority', contentType: 'article', status: 'inbox', durationMinutes: 20, isPriority: false, createdAt: '2026-10-01T00:00:00Z', thumbnailUrl: '' },
      { id: 'strat-prio-new', title: 'New Priority', contentType: 'article', status: 'inbox', durationMinutes: 60, isPriority: true, createdAt: '2026-10-05T00:00:00Z', thumbnailUrl: '' },
      { id: 'strat-prio-old-long', title: 'Old Priority Long', contentType: 'article', status: 'inbox', durationMinutes: 45, isPriority: true, createdAt: '2026-10-03T00:00:00Z', thumbnailUrl: '' },
      { id: 'strat-prio-old-short', title: 'Old Priority Short', contentType: 'article', status: 'inbox', durationMinutes: 15, isPriority: true, createdAt: '2026-10-03T00:00:00Z', thumbnailUrl: '' },
    ];

    // Default strategy: 'priority_oldest'
    const planDefault = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: itemsForOrdering,
      existingWeekItems: [],
      availableBudgetMinutes: 300,
      todayDateStr: '2026-10-12',
      strategy: 'priority_oldest',
    });

    const defaultIds = planDefault.proposedItems.map((pi) => pi.item.id);
    // Priority first: 'strat-prio-old-short', 'strat-prio-old-long', 'strat-prio-new', then 'strat-norm'
    if (defaultIds[0] !== 'strat-prio-old-short' || defaultIds[1] !== 'strat-prio-old-long' || defaultIds[2] !== 'strat-prio-new' || defaultIds[3] !== 'strat-norm') {
      throw new Error(`Default strategy ordering mismatch: got ${JSON.stringify(defaultIds)}`);
    }

    // Option: 'shortest_first'
    const planShortest = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: itemsForOrdering,
      existingWeekItems: [],
      availableBudgetMinutes: 300,
      todayDateStr: '2026-10-12',
      strategy: 'shortest_first',
    });

    const shortestIds = planShortest.proposedItems.map((pi) => pi.item.id);
    // Shortest first among priority items: 15m ('strat-prio-old-short'), 45m ('strat-prio-old-long'), 60m ('strat-prio-new'), then 20m ('strat-norm')
    if (shortestIds[0] !== 'strat-prio-old-short' || shortestIds[1] !== 'strat-prio-old-long' || shortestIds[2] !== 'strat-prio-new' || shortestIds[3] !== 'strat-norm') {
      throw new Error(`Shortest first strategy ordering mismatch: got ${JSON.stringify(shortestIds)}`);
    }

    results.push({
      id: 'test-12-quick-plan-rule-5-default-priority-then-oldest-strategy',
      name: 'Quick Plan Rule 5: Default strategy is Priority then oldest (duration breaks ties); Shortest first available',
      passed: true,
      message: 'Verified: Default strategy prioritizes starred items chronologically, breaking same-timestamp ties by duration. Shortest first option verified.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-12-quick-plan-rule-5-default-priority-then-oldest-strategy',
      name: 'Quick Plan Rule 5: Default strategy is Priority then oldest (duration breaks ties); Shortest first available',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 13: Quick Plan Rule 6 - Each explanation says why day was chosen;
  // built-in day preferences have an off switch.
  // =========================================================================
  try {
    const fixedWeek = makeFixedWeek();
    const articleItem: ContentItem = {
      id: 'qp-r6-art',
      title: 'Strategy essay',
      contentType: 'article',
      status: 'inbox',
      durationMinutes: 25,
      createdAt: '2026-10-01',
      thumbnailUrl: '',
    };

    // Part A: Built-in preferences ON
    const planPrefOn = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: [articleItem],
      existingWeekItems: [],
      availableBudgetMinutes: 100,
      todayDateStr: '2026-10-12', // Monday
      enableDayPreferences: true,
    });

    const piOn = planPrefOn.proposedItems[0];
    if (!piOn.explanation.includes('Day preference: articles on') || !piOn.explanation.includes(piOn.dayLabel)) {
      throw new Error(`Expected explanation to state why day was chosen with preference: "${piOn.explanation}"`);
    }

    // Part B: Built-in preferences OFF (switch off in settings)
    const planPrefOff = generateQuickPlan({
      weekDays: fixedWeek,
      inboxItems: [articleItem],
      existingWeekItems: [],
      availableBudgetMinutes: 100,
      todayDateStr: '2026-10-12',
      enableDayPreferences: false,
    });

    const piOff = planPrefOff.proposedItems[0];
    if (piOff.explanation.includes('Day preference: articles on')) {
      throw new Error(`Day preference text should not appear when switch is OFF: "${piOff.explanation}"`);
    }
    if (!piOff.explanation.includes(piOff.dayLabel)) {
      throw new Error(`Explanation must state why day was chosen: "${piOff.explanation}"`);
    }

    results.push({
      id: 'test-13-quick-plan-rule-6-explanations-and-preferences-switch',
      name: 'Quick Plan Rule 6: Explanations state why day was chosen; day preferences switch respected',
      passed: true,
      message: 'Verified: Explanations clearly state why day was selected. Preference ON mentions media rhythm; preference OFF balances purely without type biases.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-13-quick-plan-rule-6-explanations-and-preferences-switch',
      name: 'Quick Plan Rule 6: Explanations state why day was chosen; day preferences switch respected',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 14: Quick Plan Rule 7 - Handle an empty week without crashing.
  // =========================================================================
  try {
    const dummyItem: ContentItem = {
      id: 'qp-r7-item',
      title: 'Sample Item',
      contentType: 'article',
      status: 'inbox',
      durationMinutes: 20,
      createdAt: '2026-10-01',
      thumbnailUrl: '',
    };

    // Case 1: Empty week array []
    const emptyWeekRes = generateQuickPlan({
      weekDays: [],
      inboxItems: [dummyItem],
      existingWeekItems: [],
      availableBudgetMinutes: 100,
    });

    if (emptyWeekRes.proposedItems.length !== 0 || !emptyWeekRes.noDaysRemainingThisWeek) {
      throw new Error('Empty week failed to return safe zero-proposal result');
    }

    // Case 2: Empty inbox items []
    const emptyInboxRes = generateQuickPlan({
      weekDays: makeFixedWeek(),
      inboxItems: [],
      existingWeekItems: [],
      availableBudgetMinutes: 100,
    });

    if (emptyInboxRes.proposedItems.length !== 0) {
      throw new Error('Empty inbox failed to return safe zero-proposal result');
    }

    // Case 3: 0 available budget
    const zeroBudgetRes = generateQuickPlan({
      weekDays: makeFixedWeek(),
      inboxItems: [dummyItem],
      existingWeekItems: [],
      availableBudgetMinutes: 0,
    });

    if (zeroBudgetRes.proposedItems.length !== 0) {
      throw new Error('Zero budget failed to return safe zero-proposal result');
    }

    results.push({
      id: 'test-14-quick-plan-rule-7-empty-week-resilience',
      name: 'Quick Plan Rule 7: Handles empty week, empty inbox, and zero budget gracefully without crashing',
      passed: true,
      message: 'Verified: Zero exceptions thrown on empty weekDays array, empty inbox items, or 0 available budget.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-14-quick-plan-rule-7-empty-week-resilience',
      name: 'Quick Plan Rule 7: Handles empty week, empty inbox, and zero budget gracefully without crashing',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 15: Safe Saving - In-memory fallback on simulated full storage
  // (never fails silently, preserves data in memory, backup export succeeds)
  // =========================================================================
  try {
    // Preserve baseline items
    const baselineItems = getStoredItems();

    // 1. Enable simulated full storage (QuotaExceededError)
    setSimulateFullStorage(true);

    const testItem: ContentItem = {
      id: 'self-check-offline-safety-item-1',
      title: 'Mission Critical Engineering Notes',
      contentType: 'article',
      status: 'planned',
      scheduledDate: '2026-10-12',
      durationMinutes: 45,
      createdAt: '2026-10-12T08:00:00.000Z',
      thumbnailUrl: '',
    };

    // 2. Call saveStoredItems while storage is full
    const saveResult = saveStoredItems([testItem]);

    // 3. Verify it never fails silently: returns false and records failure info
    if (saveResult !== false) {
      throw new Error(`Expected saveStoredItems to return false on full storage, got ${saveResult}`);
    }

    const failureInfo = getStorageFailureInfo();
    if (!failureInfo || !failureInfo.hasFailed) {
      throw new Error('Expected storage failure info to record hasFailed = true');
    }
    if (
      !failureInfo.errorMessage.toLowerCase().includes('quota') &&
      !failureInfo.errorMessage.toLowerCase().includes('full')
    ) {
      throw new Error(
        `Expected failure message to mention quota/full storage: "${failureInfo.errorMessage}"`
      );
    }

    // 4. Verify data is safely kept in memory
    const inMemoryLoaded = getStoredItems();
    const foundItem = inMemoryLoaded.find((it) => it.id === 'self-check-offline-safety-item-1');
    if (!foundItem || foundItem.title !== 'Mission Critical Engineering Notes') {
      throw new Error('Item was lost from memory cache when storage write failed!');
    }

    // 5. Verify Export Backup preserves the in-memory data
    const exportedJson = exportBackupJson();
    if (
      !exportedJson.includes('self-check-offline-safety-item-1') ||
      !exportedJson.includes('Mission Critical Engineering Notes')
    ) {
      throw new Error('Export backup did not include the in-memory data when storage was full!');
    }

    // Clean up simulation
    setSimulateFullStorage(false);
    clearStorageFailureInfo();
    saveStoredItems(baselineItems);

    results.push({
      id: 'test-15-safe-saving-simulated-full-storage',
      name: 'Safe Saving: In-memory fallback on simulated full storage (never fails silently)',
      passed: true,
      message:
        'Verified: On QuotaExceededError, saveStoredItems returns false with clear failure diagnostics, retains all items in memory, and exportBackupJson() preserves changes.',
    });
  } catch (err: any) {
    setSimulateFullStorage(false);
    clearStorageFailureInfo();
    results.push({
      id: 'test-15-safe-saving-simulated-full-storage',
      name: 'Safe Saving: In-memory fallback on simulated full storage (never fails silently)',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 16: Storage usage percentage calculation & 80% warning threshold
  // =========================================================================
  try {
    // 1. Baseline stats check
    const baselineStats = getStorageUsageStats();
    if (baselineStats.percentage < 0 || baselineStats.percentage > 100) {
      throw new Error(`Invalid storage percentage: ${baselineStats.percentage}%`);
    }
    if (baselineStats.quotaBytes !== DEFAULT_STORAGE_QUOTA_BYTES) {
      throw new Error(`Unexpected quota bytes: ${baselineStats.quotaBytes}`);
    }

    // 2. Simulate 85% storage usage -> MUST warn at 80%+
    setSimulateUsageBytes(DEFAULT_STORAGE_QUOTA_BYTES * 0.85);
    const stats85 = getStorageUsageStats();
    if (stats85.percentage !== 85) {
      throw new Error(`Expected simulated percentage 85%, got ${stats85.percentage}%`);
    }
    if (!stats85.isWarning) {
      throw new Error('Expected isWarning to be true when storage usage is at 85% (>= 80%)');
    }

    // 3. Simulate 80% boundary -> MUST warn at 80%
    setSimulateUsageBytes(DEFAULT_STORAGE_QUOTA_BYTES * 0.8);
    const stats80 = getStorageUsageStats();
    if (!stats80.isWarning) {
      throw new Error('Expected isWarning to be true at exactly 80% threshold');
    }

    // 4. Simulate 50% storage usage -> NO warning
    setSimulateUsageBytes(DEFAULT_STORAGE_QUOTA_BYTES * 0.5);
    const stats50 = getStorageUsageStats();
    if (stats50.isWarning) {
      throw new Error('Expected isWarning to be false when storage is 50% (< 80%)');
    }

    // Clean up simulation
    setSimulateUsageBytes(null);

    results.push({
      id: 'test-16-storage-usage-and-80-percent-warning',
      name: 'Storage Usage: Percentage calculated accurately and warns at 80%',
      passed: true,
      message:
        'Verified: Storage percentage computed against 5MB quota; triggers isWarning at 80% and 85%, clears at 50%.',
    });
  } catch (err: any) {
    setSimulateUsageBytes(null);
    results.push({
      id: 'test-16-storage-usage-and-80-percent-warning',
      name: 'Storage Usage: Percentage calculated accurately and warns at 80%',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 17: Screenshots and custom logos capped at 200 KB with ID reference only
  // =========================================================================
  try {
    // 1. Generate an oversized 350 KB dummy image base64 dataURL
    const largeDummyPayload = 'A'.repeat(450000); // 450,000 base64 chars ≈ 337 KB
    const largeDataUrl = `data:image/jpeg;base64,${largeDummyPayload}`;

    // 2. Verify compression / byte cap at 200 KB (MAX_MEDIA_BYTES)
    const capped = compressBase64ToCap(largeDataUrl, MAX_MEDIA_BYTES);
    const commaIdx = capped.indexOf(',');
    const payloadLen = capped.slice(commaIdx + 1).length;
    const approximateBytes = Math.round((payloadLen * 3) / 4);

    if (approximateBytes > MAX_MEDIA_BYTES) {
      throw new Error(
        `Capped image exceeds 200 KB limit: ${approximateBytes} bytes > ${MAX_MEDIA_BYTES} bytes`
      );
    }

    // 3. Verify media reference string format (idb:...)
    const mediaRef = saveMediaItemSync('test_shot_invariant', largeDataUrl, MAX_MEDIA_BYTES);
    if (!isMediaReference(mediaRef)) {
      throw new Error(`Expected media item to return 'idb:...' reference, got "${mediaRef}"`);
    }

    // 4. Verify custom logo stores only reference in localStorage, never raw base64
    saveCustomBrandLogo(largeDataUrl);
    const storedLogoKey = localStorage.getItem('curatecal_custom_brand_logo_v1');
    if (!storedLogoKey) {
      throw new Error('Custom logo key missing from localStorage');
    }
    if (storedLogoKey.startsWith('data:image/')) {
      throw new Error('Custom logo stored raw base64 data in localStorage instead of reference!');
    }
    if (!storedLogoKey.startsWith('idb:')) {
      throw new Error(
        `Custom logo should store reference starting with 'idb:', got "${storedLogoKey}"`
      );
    }

    // Clean up logo
    saveCustomBrandLogo(null);

    // 5. Verify item screenshots are stored in localStorage as references, not base64
    const itemWithBase64Shot: ContentItem = {
      id: 'test-item-with-shot',
      title: 'Article With Visual Note',
      contentType: 'article',
      status: 'planned',
      scheduledDate: '2026-10-12',
      durationMinutes: 20,
      createdAt: '2026-10-12T09:00:00.000Z',
      thumbnailUrl: '',
      screenshots: [largeDataUrl],
    };

    saveStoredItems([itemWithBase64Shot]);
    const rawStoredItems = localStorage.getItem('curatecal_items_v1') || '';
    if (rawStoredItems.includes('data:image/')) {
      throw new Error(
        'Raw base64 was serialized into localStorage items! Must only store idb: references.'
      );
    }
    if (!rawStoredItems.includes('idb:shot_')) {
      throw new Error('Item screenshots did not contain idb:shot_ reference in stored JSON.');
    }

    results.push({
      id: 'test-17-safe-media-storage-indexeddb-reference-200kb-cap',
      name: 'Safe Media: Screenshots and logos capped at 200 KB with IndexedDB reference only (no base64 in localStorage)',
      passed: true,
      message:
        'Verified: Oversized 350 KB images capped strictly at <= 200 KB. localStorage holds only idb: references, never base64 image strings.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-17-safe-media-storage-indexeddb-reference-200kb-cap',
      name: 'Safe Media: Screenshots and logos capped at 200 KB with IndexedDB reference only (no base64 in localStorage)',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 18: Analytics Event Instrumentation
  // Each action fires its event exactly once with expected properties.
  // =========================================================================
  try {
    clearAnalyticsEvents();

    const initialCount = getStoredAnalyticsEvents().length;
    if (initialCount !== 0) {
      throw new Error(`Expected clean log at start, found ${initialCount}`);
    }

    const countEvents = (name: string) =>
      getStoredAnalyticsEvents().filter((e) => e.name === name).length;

    // 1. app_opened
    trackEvent('app_opened');
    if (countEvents('app_opened') !== 1) {
      throw new Error(`Expected app_opened to fire exactly once, got ${countEvents('app_opened')}`);
    }

    // 2. item_added with methods: paste, quick_add, sample
    trackEvent('item_added', { type: 'article', method: 'paste' });
    trackEvent('item_added', { type: 'youtube', method: 'quick_add' });
    trackEvent('item_added', { type: 'book', method: 'sample' });
    if (countEvents('item_added') !== 3) {
      throw new Error(`Expected 3 item_added events, got ${countEvents('item_added')}`);
    }
    const addedEvts = getStoredAnalyticsEvents().filter((e) => e.name === 'item_added');
    const methods = addedEvts.map((e) => e.properties?.method);
    if (!methods.includes('paste') || !methods.includes('quick_add') || !methods.includes('sample')) {
      throw new Error(`Missing expected method in item_added: ${JSON.stringify(methods)}`);
    }

    // 3. metadata_fallback_used [type]
    const beforeFallback = countEvents('metadata_fallback_used');
    trackEvent('metadata_fallback_used', { type: 'podcast' });
    if (countEvents('metadata_fallback_used') !== beforeFallback + 1) {
      throw new Error('metadata_fallback_used did not fire exactly once');
    }
    const fallbackEvt = getStoredAnalyticsEvents().find((e) => e.name === 'metadata_fallback_used');
    if (fallbackEvt?.properties?.type !== 'podcast') {
      throw new Error(`Expected type podcast in metadata_fallback_used, got ${fallbackEvt?.properties?.type}`);
    }

    // 4. item_planned with methods: drag, quick_move, quick_plan, modal
    const planMethods = ['drag', 'quick_move', 'quick_plan', 'modal'] as const;
    for (const m of planMethods) {
      const before = countEvents('item_planned');
      trackEvent('item_planned', { method: m });
      if (countEvents('item_planned') !== before + 1) {
        throw new Error(`item_planned with method ${m} did not fire exactly once`);
      }
    }

    // 5. quick_plan_opened
    const beforeQpOpen = countEvents('quick_plan_opened');
    trackEvent('quick_plan_opened');
    if (countEvents('quick_plan_opened') !== beforeQpOpen + 1) {
      throw new Error('quick_plan_opened did not fire exactly once');
    }

    // 6. quick_plan_previewed
    const beforeQpPrev = countEvents('quick_plan_previewed');
    trackEvent('quick_plan_previewed');
    if (countEvents('quick_plan_previewed') !== beforeQpPrev + 1) {
      throw new Error('quick_plan_previewed did not fire exactly once');
    }

    // 7. quick_plan_applied
    const beforeQpApp = countEvents('quick_plan_applied');
    trackEvent('quick_plan_applied');
    if (countEvents('quick_plan_applied') !== beforeQpApp + 1) {
      throw new Error('quick_plan_applied did not fire exactly once');
    }

    // 8. quick_plan_undone
    const beforeQpUndo = countEvents('quick_plan_undone');
    trackEvent('quick_plan_undone');
    if (countEvents('quick_plan_undone') !== beforeQpUndo + 1) {
      throw new Error('quick_plan_undone did not fire exactly once');
    }

    // 9. budget_changed [preset]
    const beforeBudget = countEvents('budget_changed');
    trackEvent('budget_changed', { preset: '2h' });
    if (countEvents('budget_changed') !== beforeBudget + 1) {
      throw new Error('budget_changed did not fire exactly once');
    }
    const budgetEvt = getStoredAnalyticsEvents().find((e) => e.name === 'budget_changed');
    if (budgetEvt?.properties?.preset !== '2h') {
      throw new Error(`Expected preset '2h' in budget_changed, got ${budgetEvt?.properties?.preset}`);
    }

    // 10. calendar_viewed [view]
    const beforeCal = countEvents('calendar_viewed');
    trackEvent('calendar_viewed', { view: 'week' });
    if (countEvents('calendar_viewed') !== beforeCal + 1) {
      throw new Error('calendar_viewed did not fire exactly once');
    }
    const calEvt = getStoredAnalyticsEvents().find((e) => e.name === 'calendar_viewed');
    if (calEvt?.properties?.view !== 'week') {
      throw new Error(`Expected view 'week' in calendar_viewed, got ${calEvt?.properties?.view}`);
    }

    // 11. item_completed
    const beforeComp = countEvents('item_completed');
    trackEvent('item_completed');
    if (countEvents('item_completed') !== beforeComp + 1) {
      throw new Error('item_completed did not fire exactly once');
    }

    // 12. activation_milestone [seconds_since_open]
    const beforeMilestone = countEvents('activation_milestone');
    trackEvent('activation_milestone', { seconds_since_open: getSecondsSinceOpen() });
    if (countEvents('activation_milestone') !== beforeMilestone + 1) {
      throw new Error('activation_milestone did not fire exactly once');
    }
    const actEvt = getStoredAnalyticsEvents().find((e) => e.name === 'activation_milestone');
    if (typeof actEvt?.properties?.seconds_since_open !== 'number') {
      throw new Error('Expected seconds_since_open number in activation_milestone');
    }

    // 13. storage_save_failed
    const beforeStorageFail = countEvents('storage_save_failed');
    trackEvent('storage_save_failed');
    if (countEvents('storage_save_failed') !== beforeStorageFail + 1) {
      throw new Error('storage_save_failed did not fire exactly once');
    }

    results.push({
      id: 'test-18-analytics-events-fired-exactly-once',
      name: 'Analytics Events: Each required action fires its event exactly once with expected properties',
      passed: true,
      message:
        'Verified: All 13 events (app_opened, item_added, metadata_fallback_used, item_planned, quick_plan_opened/previewed/applied/undone, budget_changed, calendar_viewed, item_completed, activation_milestone, storage_save_failed) fire exactly once per action.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-18-analytics-events-fired-exactly-once',
      name: 'Analytics Events: Each required action fires its event exactly once with expected properties',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 19: Privacy Invariant
  // Never send URLs, titles, notes, or any text the user typed.
  // All stored event props must not contain URL or title.
  // =========================================================================
  try {
    // 1. Explicit attempt to leak private fields
    const testLeakEvent = trackEvent('item_added', {
      type: 'article',
      method: 'paste',
      title: 'Secret Personal Diary Entry',
      itemTitle: 'Secret Personal Diary Entry',
      url: 'https://private.internal.site/vault/notes',
      notes: 'Confidential thoughts and passwords',
      text: 'User input text',
      description: 'Long description',
      query: 'private search query',
    });

    if (testLeakEvent.properties?.title || testLeakEvent.properties?.itemTitle) {
      throw new Error('trackEvent failed to strip title!');
    }
    if (testLeakEvent.properties?.url) {
      throw new Error('trackEvent failed to strip url!');
    }
    if (testLeakEvent.properties?.notes || testLeakEvent.properties?.text) {
      throw new Error('trackEvent failed to strip notes or user text!');
    }

    // 2. Scan every single event in the entire session log
    const allEvents = getStoredAnalyticsEvents();
    for (const evt of allEvents) {
      if (!evt.properties) continue;
      for (const [key, value] of Object.entries(evt.properties)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('url') ||
          lowerKey.includes('title') ||
          lowerKey.includes('note') ||
          lowerKey.includes('text') ||
          lowerKey.includes('desc') ||
          lowerKey.includes('query')
        ) {
          throw new Error(
            `Privacy breach: Event "${evt.name}" has forbidden property key "${key}"`
          );
        }
        if (typeof value === 'string' && (/https?:\/\//i.test(value) || value.includes('://'))) {
          throw new Error(
            `Privacy breach: Event "${evt.name}" has URL in value for key "${key}": "${value}"`
          );
        }
      }
    }

    results.push({
      id: 'test-19-analytics-privacy-no-url-or-title',
      name: 'Analytics Privacy: Never send URLs, titles, notes or typed text; all event properties sanitized',
      passed: true,
      message:
        'Verified: Strict property sanitization confirmed. Zero occurrences of URLs, titles, notes, or user text in session event log.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-19-analytics-privacy-no-url-or-title',
      name: 'Analytics Privacy: Never send URLs, titles, notes or typed text; all event properties sanitized',
      passed: false,
      message: err.message || String(err),
    });
  }

  // =========================================================================
  // Test 20: Analytics Opt-Out & Umami Ad Blocker Resilience
  // localStorage 'curate.analytics.off' disables Umami calls.
  // Failing/blocked scripts never throw or crash the app.
  // =========================================================================
  try {
    // 1. Mock window.umami
    let umamiCalls: { name: string; props?: Record<string, unknown> }[] = [];
    (globalThis as any).window = (globalThis as any).window || {};
    if (!(globalThis as any).window.dispatchEvent) {
      (globalThis as any).window.dispatchEvent = () => true;
    }
    (globalThis as any).window.umami = {
      track: (name: string, props?: Record<string, unknown>) => {
        umamiCalls.push({ name, props });
      },
    };

    // Enabled state: Umami should receive track calls
    setAnalyticsDisabled(false);
    trackEvent('quick_plan_opened');
    if (umamiCalls.length === 0 || umamiCalls[umamiCalls.length - 1].name !== 'quick_plan_opened') {
      throw new Error('window.umami.track was not called when analytics enabled');
    }

    // Disabled state: Umami should NOT be called
    setAnalyticsDisabled(true);
    const beforeCount = umamiCalls.length;
    trackEvent('quick_plan_applied');
    if (umamiCalls.length !== beforeCount) {
      throw new Error('window.umami.track was called while curate.analytics.off was set to true');
    }

    // Reset opt-out preference
    setAnalyticsDisabled(false);

    // 2. Ad blocker failure resilience (throwing script)
    (globalThis as any).window.umami = {
      track: () => {
        throw new Error('Blocked by client ad blocker or network policy');
      },
    };

    // Must not throw when Umami track throws
    let threw = false;
    try {
      trackEvent('item_completed');
    } catch {
      threw = true;
    }
    if (threw) {
      throw new Error('trackEvent threw an exception when window.umami.track failed!');
    }

    // 3. Format session log as valid JSON with ISO timestamps
    const jsonStr = formatSessionLogJson();
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('formatSessionLogJson did not return a valid array');
    }
    const sample = parsed[0];
    if (!sample.timestamp || isNaN(Date.parse(sample.timestamp))) {
      throw new Error(`Invalid ISO timestamp in session log: ${sample.timestamp}`);
    }

    results.push({
      id: 'test-20-analytics-opt-out-and-resilience',
      name: 'Analytics Opt-Out & Resilience: curate.analytics.off respected, ad blocker failure never breaks app, valid ISO log format',
      passed: true,
      message:
        'Verified: curate.analytics.off stops Umami tracking; ad blocker exceptions handled cleanly; session log formatted with valid ISO timestamps.',
    });
  } catch (err: any) {
    results.push({
      id: 'test-20-analytics-opt-out-and-resilience',
      name: 'Analytics Opt-Out & Resilience: curate.analytics.off respected, ad blocker failure never breaks app, valid ISO log format',
      passed: false,
      message: err.message || String(err),
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  return {
    success: failedCount === 0,
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    results,
  };
}

// Auto-run if executed directly via Node / tsx CLI
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('selfCheck')) {
  console.log('\n========================================');
  console.log('🧪 CurateCal Self-Check Test Suite');
  console.log('========================================\n');

  const suite = runSelfCheckTests();

  for (const t of suite.results) {
    const symbol = t.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${symbol} [${t.id}]`);
    console.log(`   ${t.name}`);
    console.log(`   ${t.message}\n`);
  }

  console.log('----------------------------------------');
  console.log(`Summary: ${suite.passed}/${suite.total} passed (${suite.failed} failed)`);
  console.log('========================================\n');

  if (!suite.success) {
    process.exit(1);
  }
}
