import { ContentItem, DayTheme, DEFAULT_TOPICS, BudgetPreset } from '../types';
import { generateEditorialCoverSvg } from './metadataExtractor';
import { getOffsetDateStr } from './dateUtils';
import { saveMediaItem, saveMediaItemSync, MAX_MEDIA_BYTES } from './mediaStorage';
import { trackEvent } from './analytics';

export const CURRENT_SCHEMA_VERSION = 1;
export const DEFAULT_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024; // 5 MB standard localStorage quota

const STORAGE_KEYS = {
  ITEMS: 'curatecal_items_v1',
  DAY_THEMES: 'curatecal_day_themes_v1',
  CUSTOM_TOPICS: 'curatecal_custom_topics_v1',
  WEEK_BUDGET_PREFIX: 'curatecal_week_budget_',
  SCHEMA_VERSION: 'curatecal_schema_version_v1',
};

// In-memory data layer to guarantee zero data loss if browser storage fails
let inMemoryItems: ContentItem[] | null = null;
let inMemoryDayThemes: DayTheme[] | null = null;
let inMemoryCustomTopics: string[] | null = null;
const inMemoryWeekBudgets = new Map<string, { availableMinutes: number; preset: BudgetPreset }>();
let inMemoryDayPreferencesEnabled: boolean | null = null;

export interface StorageFailureInfo {
  hasFailed: boolean;
  errorMessage: string;
  failedAt: string;
  failedOperation: string;
}

let lastStorageFailure: StorageFailureInfo | null = null;

// Simulation flags for full storage and quota invariant testing
let simulatedFullStorage = false;
let simulatedUsageBytes: number | null = null;

export interface StorageUsageStats {
  usedBytes: number;
  quotaBytes: number;
  percentage: number; // 0 - 100
  isWarning: boolean; // >= 80%
  formattedUsed: string;
  formattedQuota: string;
  itemCount: number;
}

export function getStorageFailureInfo(): StorageFailureInfo | null {
  return lastStorageFailure;
}

export function clearStorageFailureInfo(): void {
  lastStorageFailure = null;
}

export function setSimulateFullStorage(simulate: boolean): void {
  simulatedFullStorage = simulate;
}

export function isSimulateFullStorage(): boolean {
  return simulatedFullStorage;
}

export function setSimulateUsageBytes(bytes: number | null): void {
  simulatedUsageBytes = bytes;
}

/**
 * Calculates current browser storage usage percentage and warns at 80%.
 */
export function getStorageUsageStats(): StorageUsageStats {
  let usedBytes = 0;
  if (simulatedUsageBytes !== null) {
    usedBytes = Math.max(0, simulatedUsageBytes);
  } else {
    try {
      if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            const val = localStorage.getItem(key) || '';
            // UTF-16 characters use 2 bytes per character
            usedBytes += (key.length + val.length) * 2;
          }
        }
      }
    } catch (err) {
      console.warn('[Storage] Could not compute storage size:', err);
    }
  }

  const quotaBytes = DEFAULT_STORAGE_QUOTA_BYTES;
  const rawPct = (usedBytes / quotaBytes) * 100;
  const percentage = Math.min(100, Math.max(0, Math.round(rawPct * 10) / 10));
  const isWarning = percentage >= 80;

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const currentCount = inMemoryItems !== null ? inMemoryItems.length : getStoredItems().length;

  return {
    usedBytes,
    quotaBytes,
    percentage,
    isWarning,
    formattedUsed: formatBytes(usedBytes),
    formattedQuota: formatBytes(quotaBytes),
    itemCount: currentCount,
  };
}

/**
 * Normalizes and upgrades an individual raw item from older schema variations
 * to ensure all current required properties are safely populated.
 */
export function migrateItem(raw: any): ContentItem {
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `item-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    url: typeof raw?.url === 'string' ? raw.url : undefined,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled Item',
    thumbnailUrl: typeof raw?.thumbnailUrl === 'string' ? raw.thumbnailUrl : '',
    contentType: [
      'youtube',
      'podcast',
      'article',
      'book',
      'course',
      'documentary',
      'other',
    ].includes(raw?.contentType)
      ? raw.contentType
      : 'other',
    source: typeof raw?.source === 'string' ? raw.source : undefined,
    platform: typeof raw?.platform === 'string' ? raw.platform : undefined,
    author: typeof raw?.author === 'string' ? raw.author : undefined,
    durationMinutes:
      typeof raw?.durationMinutes === 'number' && !isNaN(raw.durationMinutes) && raw.durationMinutes > 0
        ? Math.round(raw.durationMinutes)
        : undefined,
    topic: typeof raw?.topic === 'string' ? raw.topic : undefined,
    status: ['inbox', 'planned', 'in_progress', 'completed'].includes(raw?.status)
      ? raw.status
      : 'inbox',
    scheduledDate:
      typeof raw?.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.scheduledDate)
        ? raw.scheduledDate
        : undefined,
    scheduledEndDate:
      typeof raw?.scheduledEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.scheduledEndDate)
        ? raw.scheduledEndDate
        : undefined,
    notes: typeof raw?.notes === 'string' ? raw.notes : undefined,
    keyTakeaway: typeof raw?.keyTakeaway === 'string' ? raw.keyTakeaway : undefined,
    screenshots: Array.isArray(raw?.screenshots) ? raw.screenshots : undefined,
    spatialX: typeof raw?.spatialX === 'number' ? raw.spatialX : undefined,
    spatialY: typeof raw?.spatialY === 'number' ? raw.spatialY : undefined,
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    completedAt: typeof raw?.completedAt === 'string' ? raw.completedAt : undefined,
    isPriority: Boolean(raw?.isPriority),
    isSample: Boolean(raw?.isSample),
  };
}

export interface StorageMigrationResult {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  itemCount: number;
}

/**
 * Ensures stored data in localStorage adheres to CURRENT_SCHEMA_VERSION.
 * Safely migrates schema and updates version metadata.
 */
export function migrateStoredData(): StorageMigrationResult {
  try {
    const rawVersion = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
    const existingVersion = rawVersion ? parseInt(rawVersion, 10) : 0;

    const rawItems = localStorage.getItem(STORAGE_KEYS.ITEMS);
    let items: ContentItem[] = [];
    if (rawItems) {
      const parsed = JSON.parse(rawItems);
      if (Array.isArray(parsed)) {
        items = parsed.map(migrateItem);
        localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items));
      }
    }

    // Record schema version in localStorage
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));

    return {
      migrated: existingVersion < CURRENT_SCHEMA_VERSION,
      fromVersion: existingVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      itemCount: items.length,
    };
  } catch (err) {
    console.warn('[Storage] Migration notice:', err);
    return {
      migrated: false,
      fromVersion: 0,
      toVersion: CURRENT_SCHEMA_VERSION,
      itemCount: 0,
    };
  }
}

// Default subtle weekday preferences (Monday = Marketing, etc.)
export const DEFAULT_DAY_THEMES: DayTheme[] = [
  { dayOfWeek: 1, topic: 'Marketing', enabled: true },
  { dayOfWeek: 2, topic: 'Psychology', enabled: true },
  { dayOfWeek: 3, topic: 'Business', enabled: true },
  { dayOfWeek: 4, topic: 'German', enabled: true },
  { dayOfWeek: 5, topic: 'UX/UI', enabled: true },
  { dayOfWeek: 6, topic: 'Health & Fitness', enabled: true },
  { dayOfWeek: 0, topic: 'Philosophy & Review', enabled: true },
];

export function getStoredItems(): ContentItem[] {
  // If in-memory cache is present, return it to preserve unsaved changes
  if (inMemoryItems !== null) {
    return inMemoryItems;
  }
  try {
    // Run schema migration if version key is not current
    const storedVer = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
    if (!storedVer || parseInt(storedVer, 10) < CURRENT_SCHEMA_VERSION) {
      migrateStoredData();
    }

    const raw = localStorage.getItem(STORAGE_KEYS.ITEMS);
    if (!raw) {
      inMemoryItems = [];
      return [];
    }
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed.map(migrateItem) : [];
    inMemoryItems = items;
    return items;
  } catch (err) {
    console.error('Failed to load items from localStorage:', err);
    return inMemoryItems || [];
  }
}

export function saveStoredItems(items: ContentItem[]): boolean {
  // 1. Keep data in memory first so user edits are NEVER lost
  inMemoryItems = items;

  // 2. Stop storing screenshots as raw base64 in localStorage. Convert any raw base64
  // into an idb:... reference and save to IndexedDB media store capped at 200 KB.
  const sanitizedItems = items.map((it) => {
    if (it.screenshots && it.screenshots.length > 0) {
      let modified = false;
      const sanitizedShots = it.screenshots.map((shot, idx) => {
        if (typeof shot === 'string' && shot.startsWith('data:image/')) {
          modified = true;
          const shotRefId = `shot_${it.id}_${idx}_${Date.now()}`;
          saveMediaItemSync(shotRefId, shot, MAX_MEDIA_BYTES);
          return `idb:${shotRefId}`;
        }
        return shot;
      });
      return modified ? { ...it, screenshots: sanitizedShots } : it;
    }
    return it;
  });

  // 3. Attempt to save to browser storage
  try {
    if (simulatedFullStorage) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }

    localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(sanitizedItems));

    // Clear previous failure if write succeeded
    if (lastStorageFailure) {
      lastStorageFailure = null;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('curatecal:storage_recovered'));
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curatecal:items_updated', { detail: sanitizedItems }));
    }
    return true;
  } catch (err: any) {
    // Never fail silently! Record failure and notify listeners
    const errorMsg =
      err?.name === 'QuotaExceededError' || err?.message?.includes('quota')
        ? 'Browser storage is full (quota exceeded).'
        : `Browser storage write failed: ${err?.message || 'Unknown error'}`;

    console.error('[Storage] Saving to browser storage failed; data kept safely in memory:', err);

    trackEvent('storage_save_failed');

    lastStorageFailure = {
      hasFailed: true,
      errorMessage: errorMsg,
      failedAt: new Date().toISOString(),
      failedOperation: 'saveStoredItems',
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('curatecal:storage_error', {
          detail: {
            error: errorMsg,
            operation: 'saveStoredItems',
            items: sanitizedItems,
          },
        })
      );
    }
    return false;
  }
}

export function clearStoredItems(): void {
  inMemoryItems = [];
  try {
    localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify([]));
    if (lastStorageFailure) {
      lastStorageFailure = null;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curatecal:items_updated', { detail: [] }));
    }
  } catch (err) {
    console.error('Failed to clear items from localStorage:', err);
  }
}

export function getStoredDayThemes(): DayTheme[] {
  if (inMemoryDayThemes !== null) {
    return inMemoryDayThemes;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DAY_THEMES);
    if (!raw) {
      inMemoryDayThemes = DEFAULT_DAY_THEMES;
      return DEFAULT_DAY_THEMES;
    }
    const parsed = JSON.parse(raw);
    const themes = Array.isArray(parsed) ? parsed : DEFAULT_DAY_THEMES;
    inMemoryDayThemes = themes;
    return themes;
  } catch {
    inMemoryDayThemes = DEFAULT_DAY_THEMES;
    return DEFAULT_DAY_THEMES;
  }
}

export function saveStoredDayThemes(themes: DayTheme[]): void {
  inMemoryDayThemes = themes;
  try {
    if (simulatedFullStorage) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    localStorage.setItem(STORAGE_KEYS.DAY_THEMES, JSON.stringify(themes));
  } catch (err) {
    console.warn('[Storage] Failed to save day themes (kept in memory):', err);
  }
}

export function getStoredCustomTopics(): string[] {
  if (inMemoryCustomTopics !== null) {
    return inMemoryCustomTopics;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_TOPICS);
    if (!raw) {
      inMemoryCustomTopics = DEFAULT_TOPICS;
      return DEFAULT_TOPICS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const merged = Array.from(new Set([...DEFAULT_TOPICS, ...parsed]));
      inMemoryCustomTopics = merged;
      return merged;
    }
    inMemoryCustomTopics = DEFAULT_TOPICS;
    return DEFAULT_TOPICS;
  } catch {
    inMemoryCustomTopics = DEFAULT_TOPICS;
    return DEFAULT_TOPICS;
  }
}

export function saveCustomTopic(newTopic: string): string[] {
  const current = getStoredCustomTopics();
  const trimmed = newTopic.trim();
  if (!trimmed || current.includes(trimmed)) return current;
  const updated = [...current, trimmed];
  inMemoryCustomTopics = updated;
  try {
    if (simulatedFullStorage) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    localStorage.setItem(STORAGE_KEYS.CUSTOM_TOPICS, JSON.stringify(updated));
  } catch (err) {
    console.warn('[Storage] Failed to save topic (kept in memory):', err);
  }
  return updated;
}

/**
 * High-quality curated starter pack with authentic YouTube thumbnails,
 * podcast covers, articles, and book covers scheduled around today's date.
 */
export function generateCuratedStarterPack(): ContentItem[] {
  const getDateStr = (offsetDays: number) => getOffsetDateStr(offsetDays);

  const starterItems: ContentItem[] = [
    {
      id: 'starter-1',
      isSample: true,
      title: 'Meta Ads Creative Strategy in 2026',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumbnailUrl: generateEditorialCoverSvg('Meta Ads Creative Strategy', 'Growth Marketing Lab', 'Marketing', 0),
      contentType: 'youtube',
      source: 'Growth Marketing Lab',
      platform: 'YouTube',
      author: 'Growth Marketing Lab',
      durationMinutes: 42,
      topic: 'Marketing',
      status: 'planned',
      scheduledDate: getDateStr(0), // Today
      notes: 'Focus on high-performing creative formats and iterate on dynamic hooks.',
      keyTakeaway: 'The creative asset itself does 80% of targeting in modern algorithmic ad systems.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'starter-2',
      isSample: true,
      title: 'The Psychology of Pricing & Perceived Value',
      url: 'https://hbr.org/pricing-psychology',
      thumbnailUrl: generateEditorialCoverSvg('The Psychology of Pricing & Value', 'Harvard Business Review', 'Psychology', 1),
      contentType: 'article',
      source: 'Harvard Business Review',
      platform: 'Harvard Business Review',
      author: 'Prof. Dan Ariely',
      durationMinutes: 14,
      topic: 'Psychology',
      status: 'planned',
      scheduledDate: getDateStr(0), // Today
      notes: 'Decoy pricing and price anchoring case studies in B2B software.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'starter-3',
      isSample: true,
      title: 'Designing with Spatial Hierarchy & Typography',
      url: 'https://www.youtube.com/watch?v=design-principles',
      thumbnailUrl: generateEditorialCoverSvg('Spatial Hierarchy & Typography', 'Refactoring UI', 'UX/UI', 2),
      contentType: 'youtube',
      source: 'Refactoring UI',
      platform: 'YouTube',
      author: 'Refactoring UI',
      durationMinutes: 28,
      topic: 'UX/UI',
      status: 'planned',
      scheduledDate: getDateStr(1), // Tomorrow
      notes: 'Contrast ratios, 4px grid rules, and optical compensations.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'starter-4',
      isSample: true,
      title: 'Thinking in Bets: Making Smarter Decisions',
      url: 'https://annie-duke.com/books',
      thumbnailUrl: generateEditorialCoverSvg('Thinking in Bets', 'Annie Duke', 'Economics', 4),
      contentType: 'book',
      source: 'Annie Duke',
      platform: 'Penguin Portfolio',
      author: 'Annie Duke',
      durationMinutes: 180,
      topic: 'Economics',
      status: 'in_progress',
      scheduledDate: getDateStr(2),
      scheduledEndDate: getDateStr(5),
      notes: 'Separating decision quality from outcome bias.',
      keyTakeaway: 'Resulting is the dangerous trap of evaluating decision quality purely by whether the outcome was lucky or unlucky.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'starter-5',
      isSample: true,
      title: 'German A2/B1 Sentence Structures & Verb Placement',
      url: 'https://www.youtube.com/watch?v=german-lesson',
      thumbnailUrl: generateEditorialCoverSvg('German A2/B1 Subordinate Clauses', 'Easy German', 'German', 3),
      contentType: 'youtube',
      source: 'Easy German',
      platform: 'YouTube',
      author: 'Easy German',
      durationMinutes: 35,
      topic: 'German',
      status: 'completed',
      scheduledDate: getDateStr(-1), // Yesterday
      notes: 'Nebensätze with weil, dass, and obwohl.',
      keyTakeaway: 'Conjugated verb kicks to the very end of subordinate clauses.',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    {
      id: 'starter-6',
      isSample: true,
      title: 'Circadian Biology & Deep Sleep Optimization',
      url: 'https://hubermanlab.com/episode-sleep',
      thumbnailUrl: generateEditorialCoverSvg('Circadian Biology & Sleep', 'Huberman Lab', 'Health', 1),
      contentType: 'podcast',
      source: 'Huberman Lab',
      platform: 'Spotify',
      author: 'Dr. Andrew Huberman',
      durationMinutes: 65,
      topic: 'Health',
      status: 'planned',
      scheduledDate: getDateStr(4),
      notes: 'Morning sunlight exposure within 30 minutes of waking.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'starter-7',
      isSample: true,
      title: 'How Complex Systems Fail (Richard Cook)',
      url: 'https://how.complexsystems.fail',
      thumbnailUrl: generateEditorialCoverSvg('How Complex Systems Fail', 'Dr. Richard Cook', 'Deep Dive', 5),
      contentType: 'article',
      source: 'Dr. Richard Cook',
      platform: 'Cognitive Systems Lab',
      author: 'Richard I. Cook, MD',
      durationMinutes: 20,
      topic: 'Deep Dive',
      status: 'inbox', // In Inbox!
      notes: 'Catastrophic failures in safety-critical engineering.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'starter-8',
      isSample: true,
      title: 'The Making of Blade Runner 2049: Cinematography',
      url: 'https://nebula.tv/documentaries/blade-runner-2049',
      thumbnailUrl: generateEditorialCoverSvg('Blade Runner 2049 Cinematography', 'Roger Deakins ASC', 'Culture', 0),
      contentType: 'documentary',
      source: 'Roger Deakins ASC',
      platform: 'Documentary Archive',
      author: 'Roger Deakins ASC',
      durationMinutes: 85,
      topic: 'Culture',
      status: 'inbox', // In Inbox!
      notes: 'Lighting rigs, silhouette framing, and practical sets.',
      createdAt: new Date().toISOString(),
    },
  ];

  return starterItems;
}

export interface BackupValidationSummary {
  valid: boolean;
  error?: string;
  schemaVersion: number;
  exportedAt?: string;
  itemCount: number;
  inboxCount: number;
  plannedCount: number;
  completedCount: number;
  themesCount: number;
  topicsCount: number;
  parsedPayload?: {
    schemaVersion: number;
    items: ContentItem[];
    dayThemes?: DayTheme[];
    customTopics?: string[];
    exportedAt?: string;
  };
}

/**
 * Validates backup JSON content, parses item counts, and ensures schema compatibility.
 */
export function validateBackupData(jsonString: string): BackupValidationSummary {
  try {
    if (!jsonString || typeof jsonString !== 'string' || !jsonString.trim()) {
      return {
        valid: false,
        error: 'The uploaded file is empty.',
        schemaVersion: 0,
        itemCount: 0,
        inboxCount: 0,
        plannedCount: 0,
        completedCount: 0,
        themesCount: 0,
        topicsCount: 0,
      };
    }
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') {
      return {
        valid: false,
        error: 'Invalid backup: root content must be a JSON object.',
        schemaVersion: 0,
        itemCount: 0,
        inboxCount: 0,
        plannedCount: 0,
        completedCount: 0,
        themesCount: 0,
        topicsCount: 0,
      };
    }
    if (!Array.isArray(data.items)) {
      return {
        valid: false,
        error: 'Invalid backup format: missing "items" list.',
        schemaVersion: 0,
        itemCount: 0,
        inboxCount: 0,
        plannedCount: 0,
        completedCount: 0,
        themesCount: 0,
        topicsCount: 0,
      };
    }

    const version =
      typeof data.schemaVersion === 'number'
        ? data.schemaVersion
        : typeof data.version === 'number'
        ? data.version
        : 1;

    // Migrate all items through schema normalizer
    const migratedItems = data.items.map(migrateItem);

    let inboxCount = 0;
    let plannedCount = 0;
    let completedCount = 0;
    for (const it of migratedItems) {
      if (it.status === 'inbox') inboxCount++;
      else if (it.status === 'completed') completedCount++;
      else plannedCount++;
    }

    const dayThemes = Array.isArray(data.dayThemes) ? data.dayThemes : undefined;
    const customTopics = Array.isArray(data.customTopics) ? data.customTopics : undefined;

    return {
      valid: true,
      schemaVersion: version,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : undefined,
      itemCount: migratedItems.length,
      inboxCount,
      plannedCount,
      completedCount,
      themesCount: dayThemes ? dayThemes.length : 0,
      topicsCount: customTopics ? customTopics.length : 0,
      parsedPayload: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        items: migratedItems,
        dayThemes,
        customTopics,
        exportedAt: data.exportedAt,
      },
    };
  } catch (err: any) {
    return {
      valid: false,
      error: `Syntax error: Invalid JSON file (${err.message || 'Malformed'})`,
      schemaVersion: 0,
      itemCount: 0,
      inboxCount: 0,
      plannedCount: 0,
      completedCount: 0,
      themesCount: 0,
      topicsCount: 0,
    };
  }
}

export function exportBackupJson(): string {
  const items = getStoredItems();
  const dayThemes = getStoredDayThemes();
  const customTopics = getStoredCustomTopics();
  return JSON.stringify(
    {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      version: CURRENT_SCHEMA_VERSION,
      appName: 'CurateCal',
      exportedAt: new Date().toISOString(),
      itemCount: items.length,
      items,
      dayThemes,
      customTopics,
    },
    null,
    2
  );
}

export function importBackupJson(jsonString: string): boolean {
  const validation = validateBackupData(jsonString);
  if (!validation.valid || !validation.parsedPayload) {
    console.error('Failed to import backup:', validation.error);
    return false;
  }

  try {
    const { items, dayThemes, customTopics } = validation.parsedPayload;
    saveStoredItems(items);
    if (dayThemes && Array.isArray(dayThemes)) {
      saveStoredDayThemes(dayThemes);
    }
    if (customTopics && Array.isArray(customTopics)) {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_TOPICS, JSON.stringify(customTopics));
    }
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));
    return true;
  } catch (err) {
    console.error('Failed to write imported backup to localStorage:', err);
    return false;
  }
}

export function getStoredWeekBudget(
  weekKey: string
): { availableMinutes: number; preset: BudgetPreset } {
  if (inMemoryWeekBudgets.has(weekKey)) {
    return inMemoryWeekBudgets.get(weekKey)!;
  }
  try {
    const raw = localStorage.getItem(`${STORAGE_KEYS.WEEK_BUDGET_PREFIX}${weekKey}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.availableMinutes === 'number') {
        inMemoryWeekBudgets.set(weekKey, parsed);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[Storage] Failed to read week budget:', err);
  }
  // Default to 3 hours (180 mins)
  const defaultBudget = { availableMinutes: 180, preset: '3h' as BudgetPreset };
  inMemoryWeekBudgets.set(weekKey, defaultBudget);
  return defaultBudget;
}

export function saveStoredWeekBudget(
  weekKey: string,
  availableMinutes: number,
  preset: BudgetPreset
): void {
  const payload = { availableMinutes, preset };
  inMemoryWeekBudgets.set(weekKey, payload);
  try {
    if (simulatedFullStorage) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    localStorage.setItem(
      `${STORAGE_KEYS.WEEK_BUDGET_PREFIX}${weekKey}`,
      JSON.stringify(payload)
    );
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('curatecal:budget_updated', {
          detail: { weekKey, availableMinutes, preset },
        })
      );
    }
  } catch (err) {
    console.warn('[Storage] Failed to save week budget (kept in memory):', err);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('curatecal:budget_updated', {
          detail: { weekKey, availableMinutes, preset },
        })
      );
    }
  }
}

export function getStoredDayPreferencesEnabled(): boolean {
  if (inMemoryDayPreferencesEnabled !== null) {
    return inMemoryDayPreferencesEnabled;
  }
  try {
    const raw = localStorage.getItem('curatecal_day_preferences_enabled_v1');
    if (raw !== null) {
      const parsed = raw === 'true';
      inMemoryDayPreferencesEnabled = parsed;
      return parsed;
    }
  } catch (err) {
    console.warn('[Storage] Failed to read day preferences enabled:', err);
  }
  inMemoryDayPreferencesEnabled = true;
  return true; // Default enabled
}

export function saveStoredDayPreferencesEnabled(enabled: boolean): void {
  inMemoryDayPreferencesEnabled = enabled;
  try {
    if (simulatedFullStorage) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    localStorage.setItem('curatecal_day_preferences_enabled_v1', String(enabled));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('curatecal:day_preferences_updated', { detail: enabled })
      );
    }
  } catch (err) {
    console.warn('[Storage] Failed to save day preferences enabled (kept in memory):', err);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('curatecal:day_preferences_updated', { detail: enabled })
      );
    }
  }
}

