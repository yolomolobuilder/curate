import { ContentItem, DayTheme, DEFAULT_TOPICS, BudgetPreset } from '../types';
import { generateEditorialCoverSvg } from './metadataExtractor';
import { getOffsetDateStr } from './dateUtils';

export const CURRENT_SCHEMA_VERSION = 1;

const STORAGE_KEYS = {
  ITEMS: 'curatecal_items_v1',
  DAY_THEMES: 'curatecal_day_themes_v1',
  CUSTOM_TOPICS: 'curatecal_custom_topics_v1',
  WEEK_BUDGET_PREFIX: 'curatecal_week_budget_',
  SCHEMA_VERSION: 'curatecal_schema_version_v1',
};

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
  try {
    // Run schema migration if version key is not current
    const storedVer = localStorage.getItem(STORAGE_KEYS.SCHEMA_VERSION);
    if (!storedVer || parseInt(storedVer, 10) < CURRENT_SCHEMA_VERSION) {
      migrateStoredData();
    }

    const raw = localStorage.getItem(STORAGE_KEYS.ITEMS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(migrateItem) : [];
  } catch (err) {
    console.error('Failed to load items from localStorage:', err);
    return [];
  }
}

export function saveStoredItems(items: ContentItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify(items));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curatecal:items_updated', { detail: items }));
    }
  } catch (err) {
    console.error('Failed to save items to localStorage:', err);
  }
}

export function clearStoredItems(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ITEMS, JSON.stringify([]));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('curatecal:items_updated', { detail: [] }));
    }
  } catch (err) {
    console.error('Failed to clear items from localStorage:', err);
  }
}

export function getStoredDayThemes(): DayTheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DAY_THEMES);
    if (!raw) return DEFAULT_DAY_THEMES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_DAY_THEMES;
  } catch {
    return DEFAULT_DAY_THEMES;
  }
}

export function saveStoredDayThemes(themes: DayTheme[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DAY_THEMES, JSON.stringify(themes));
  } catch (err) {
    console.error('Failed to save day themes:', err);
  }
}

export function getStoredCustomTopics(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_TOPICS);
    if (!raw) return DEFAULT_TOPICS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Merge unique
      return Array.from(new Set([...DEFAULT_TOPICS, ...parsed]));
    }
    return DEFAULT_TOPICS;
  } catch {
    return DEFAULT_TOPICS;
  }
}

export function saveCustomTopic(newTopic: string): string[] {
  const current = getStoredCustomTopics();
  const trimmed = newTopic.trim();
  if (!trimmed || current.includes(trimmed)) return current;
  const updated = [...current, trimmed];
  try {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_TOPICS, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save topic:', err);
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
  try {
    const raw = localStorage.getItem(`${STORAGE_KEYS.WEEK_BUDGET_PREFIX}${weekKey}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.availableMinutes === 'number') {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[Storage] Failed to read week budget:', err);
  }
  // Default to 3 hours (180 mins)
  return { availableMinutes: 180, preset: '3h' };
}

export function saveStoredWeekBudget(
  weekKey: string,
  availableMinutes: number,
  preset: BudgetPreset
): void {
  try {
    localStorage.setItem(
      `${STORAGE_KEYS.WEEK_BUDGET_PREFIX}${weekKey}`,
      JSON.stringify({ availableMinutes, preset })
    );
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('curatecal:budget_updated', {
          detail: { weekKey, availableMinutes, preset },
        })
      );
    }
  } catch (err) {
    console.warn('[Storage] Failed to save week budget:', err);
  }
}

