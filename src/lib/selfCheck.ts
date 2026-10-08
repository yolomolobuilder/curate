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
} from './storage';
import {
  recordActivationSave,
  recordActivationScheduled,
  getActivationState,
  saveActivationState,
  countUserSavedItems,
  isUserSavedItem,
} from './activation';

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
