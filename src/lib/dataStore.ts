/**
 * DataStore & LocalStore Abstraction Layer
 *
 * Prepares the application for cloud storage synchronization (e.g. Firestore / Cloud SQL)
 * while preserving existing offline-first behavior and zero data-loss guarantees.
 *
 * Rules:
 * - Snapshots include images as references ('idb:...'), never raw base64.
 * - Items track updatedAt; migration fills it if missing.
 * - mergeSnapshots(local, remote) is a pure function:
 *     - Merges by item ID.
 *     - Newer updatedAt wins.
 *     - Never silently drops either side.
 *     - Reports conflicts.
 *     - Excludes sample items.
 */

import { ContentItem, DayTheme, BudgetPreset, DEFAULT_TOPICS, APP_NAME } from '../types';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DAY_THEMES,
  getStoredItems,
  saveStoredItems,
  getStoredDayThemes,
  saveStoredDayThemes,
  getStoredCustomTopics,
  saveCustomTopic,
  getStoredWeekBudget,
  saveStoredWeekBudget,
  getStoredDayPreferencesEnabled,
  saveStoredDayPreferencesEnabled,
  clearStoredItems,
  migrateItem,
} from './storage';
import {
  saveMediaItem,
  getMediaItem,
  getMediaItemSync,
  deleteMediaItem,
  isMediaReference,
} from './mediaStorage';
import {
  getCustomBrandName,
  saveCustomBrandName,
  getCustomBrandLogo,
  saveCustomBrandLogo,
} from './brand';

export interface CurateSettings {
  dayThemes: DayTheme[];
  customTopics: string[];
  weekBudgets: Record<string, { availableMinutes: number; preset: BudgetPreset }>;
  dayPreferencesEnabled: boolean;
  brandName?: string;
  brandLogo?: string | null;
  darkMode?: boolean;
}

export interface DataSnapshot {
  schemaVersion: number;
  exportedAt: string;
  appName?: string;
  itemCount?: number;
  items: ContentItem[];
  settings: CurateSettings;
  imageRefs?: string[];
}

export interface SnapshotConflict {
  itemId: string;
  localItem: ContentItem;
  remoteItem: ContentItem;
  winner: 'local' | 'remote';
  reason: string;
}

export interface MergeStats {
  totalMergedItems: number;
  localWins: number;
  remoteWins: number;
  identical: number;
  localOnly: number;
  remoteOnly: number;
  sampleItemsExcluded: number;
}

export interface MergeResult {
  mergedSnapshot: DataSnapshot;
  conflicts: SnapshotConflict[];
  stats: MergeStats;
}

/**
 * Universal DataStore interface implemented by LocalStore and future cloud stores.
 */
export interface DataStore {
  loadAll(): Promise<{ items: ContentItem[]; settings: CurateSettings }>;
  loadAllSync?(): { items: ContentItem[]; settings: CurateSettings };
  saveItem(item: ContentItem): Promise<boolean>;
  saveItems?(items: ContentItem[]): Promise<boolean>;
  deleteItem(id: string): Promise<boolean>;
  loadSettings(): Promise<CurateSettings>;
  loadSettingsSync?(): CurateSettings;
  saveSettings(settings: Partial<CurateSettings>): Promise<boolean>;
  exportSnapshot(): Promise<DataSnapshot>;
  importSnapshot(snapshot: DataSnapshot): Promise<boolean>;

  // Settings & budget helpers
  getWeekBudget?(weekKey: string): { availableMinutes: number; preset: BudgetPreset };
  saveWeekBudget?(weekKey: string, availableMinutes: number, preset: BudgetPreset): Promise<void> | void;
  getDayPreferencesEnabled?(): boolean;
  saveDayPreferencesEnabled?(enabled: boolean): Promise<void> | void;
  addCustomTopic?(topic: string): Promise<string[]> | string[];

  // Media / image reference resolution (keeps IndexedDB access behind the store)
  saveMedia(id: string, dataUrl: string): Promise<string>;
  getMedia(refOrId: string): Promise<string | null>;
  getMediaSync(refOrId: string): string | null;
  deleteMedia(refOrId: string): Promise<void>;
}

/**
 * Pure function: compares two ContentItems for semantic equality.
 */
function areItemsEqual(a: ContentItem, b: ContentItem): boolean {
  if (a.id !== b.id) return false;
  if (a.title !== b.title) return false;
  if (a.contentType !== b.contentType) return false;
  if (a.url !== b.url) return false;
  if (a.status !== b.status) return false;
  if (a.scheduledDate !== b.scheduledDate) return false;
  if (a.scheduledEndDate !== b.scheduledEndDate) return false;
  if (a.durationMinutes !== b.durationMinutes) return false;
  if (a.durationIsEstimate !== b.durationIsEstimate) return false;
  if (a.topic !== b.topic) return false;
  if (a.notes !== b.notes) return false;
  if (a.keyTakeaway !== b.keyTakeaway) return false;
  if (a.thumbnailUrl !== b.thumbnailUrl) return false;
  if (a.isPriority !== b.isPriority) return false;
  if (a.completedAt !== b.completedAt) return false;

  const aShots = a.screenshots || [];
  const bShots = b.screenshots || [];
  if (aShots.length !== bShots.length) return false;
  for (let i = 0; i < aShots.length; i++) {
    if (aShots[i] !== bShots[i]) return false;
  }
  return true;
}

/**
 * Pure function: Merges two data snapshots.
 *
 * Requirements:
 * - Merge by item id.
 * - Newer updatedAt wins.
 * - Never silently drop either side (local-only and remote-only items are kept).
 * - Report conflicts whenever items differ.
 * - Exclude sample items.
 */
export function mergeSnapshots(local: DataSnapshot, remote: DataSnapshot): MergeResult {
  const conflicts: SnapshotConflict[] = [];

  let sampleItemsExcluded = 0;
  const localItems = (local.items || []).filter((it) => {
    if (it.isSample) {
      sampleItemsExcluded++;
      return false;
    }
    return true;
  });

  const remoteItems = (remote.items || []).filter((it) => {
    if (it.isSample) {
      sampleItemsExcluded++;
      return false;
    }
    return true;
  });

  const localMap = new Map<string, ContentItem>(localItems.map((it) => [it.id, it]));
  const remoteMap = new Map<string, ContentItem>(remoteItems.map((it) => [it.id, it]));

  const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);

  const mergedItems: ContentItem[] = [];
  let localWins = 0;
  let remoteWins = 0;
  let identical = 0;
  let localOnly = 0;
  let remoteOnly = 0;

  for (const id of allIds) {
    const localItem = localMap.get(id);
    const remoteItem = remoteMap.get(id);

    if (localItem && !remoteItem) {
      // Present only in local: keep it (never drop)
      mergedItems.push(localItem);
      localOnly++;
    } else if (!localItem && remoteItem) {
      // Present only in remote: keep it (never drop)
      mergedItems.push(remoteItem);
      remoteOnly++;
    } else if (localItem && remoteItem) {
      // Present in both: check equality first
      if (areItemsEqual(localItem, remoteItem)) {
        // Semantically identical; keep localItem without conflict
        mergedItems.push(localItem);
        identical++;
      } else {
        // Differing content: compare updatedAt
        const localTime = Date.parse(localItem.updatedAt || localItem.createdAt || '0');
        const remoteTime = Date.parse(remoteItem.updatedAt || remoteItem.createdAt || '0');

        if (remoteTime > localTime) {
          mergedItems.push(remoteItem);
          remoteWins++;
          conflicts.push({
            itemId: id,
            localItem,
            remoteItem,
            winner: 'remote',
            reason: `Remote item is newer (${remoteItem.updatedAt || 'unknown'} vs local ${
              localItem.updatedAt || 'unknown'
            })`,
          });
        } else if (localTime > remoteTime) {
          mergedItems.push(localItem);
          localWins++;
          conflicts.push({
            itemId: id,
            localItem,
            remoteItem,
            winner: 'local',
            reason: `Local item is newer (${localItem.updatedAt || 'unknown'} vs remote ${
              remoteItem.updatedAt || 'unknown'
            })`,
          });
        } else {
          // Timestamps identical or unparseable: deterministically resolve to remote, report conflict
          mergedItems.push(remoteItem);
          remoteWins++;
          conflicts.push({
            itemId: id,
            localItem,
            remoteItem,
            winner: 'remote',
            reason: `Items differ with identical timestamps (${localItem.updatedAt || 'unknown'}); remote winner`,
          });
        }
      }
    }
  }

  // Merge Settings
  const remoteExportedTime = Date.parse(remote.exportedAt || '0');
  const localExportedTime = Date.parse(local.exportedAt || '0');
  const remoteIsNewer = remoteExportedTime >= localExportedTime;

  // Union of custom topics
  const combinedTopics = Array.from(
    new Set([
      ...(local.settings?.customTopics || DEFAULT_TOPICS),
      ...(remote.settings?.customTopics || DEFAULT_TOPICS),
    ])
  );

  // Merge week budgets
  const mergedBudgets = {
    ...(local.settings?.weekBudgets || {}),
    ...(remote.settings?.weekBudgets || {}),
  };

  const mergedSettings: CurateSettings = {
    dayThemes: remoteIsNewer
      ? remote.settings?.dayThemes || local.settings?.dayThemes || DEFAULT_DAY_THEMES
      : local.settings?.dayThemes || remote.settings?.dayThemes || DEFAULT_DAY_THEMES,
    customTopics: combinedTopics,
    weekBudgets: mergedBudgets,
    dayPreferencesEnabled: remoteIsNewer
      ? remote.settings?.dayPreferencesEnabled ?? local.settings?.dayPreferencesEnabled ?? true
      : local.settings?.dayPreferencesEnabled ?? remote.settings?.dayPreferencesEnabled ?? true,
    brandName: remoteIsNewer
      ? remote.settings?.brandName || local.settings?.brandName
      : local.settings?.brandName || remote.settings?.brandName,
    brandLogo: remoteIsNewer
      ? remote.settings?.brandLogo || local.settings?.brandLogo
      : local.settings?.brandLogo || remote.settings?.brandLogo,
    darkMode: remoteIsNewer
      ? remote.settings?.darkMode ?? local.settings?.darkMode
      : local.settings?.darkMode ?? remote.settings?.darkMode,
  };

  // Collect image references from all merged items and settings
  const imageRefs = new Set<string>();
  for (const it of mergedItems) {
    if (it.screenshots) {
      for (const s of it.screenshots) {
        if (isMediaReference(s)) imageRefs.add(s);
      }
    }
    if (it.thumbnailUrl && isMediaReference(it.thumbnailUrl)) {
      imageRefs.add(it.thumbnailUrl);
    }
  }
  if (mergedSettings.brandLogo && isMediaReference(mergedSettings.brandLogo)) {
    imageRefs.add(mergedSettings.brandLogo);
  }

  const mergedSnapshot: DataSnapshot = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appName: APP_NAME,
    itemCount: mergedItems.length,
    items: mergedItems,
    settings: mergedSettings,
    imageRefs: Array.from(imageRefs),
  };

  return {
    mergedSnapshot,
    conflicts,
    stats: {
      totalMergedItems: mergedItems.length,
      localWins,
      remoteWins,
      identical,
      localOnly,
      remoteOnly,
      sampleItemsExcluded,
    },
  };
}

/**
 * LocalStore implementation: Wraps all localStorage and IndexedDB access.
 */
export class LocalStore implements DataStore {
  loadAllSync(): { items: ContentItem[]; settings: CurateSettings } {
    const rawItems = getStoredItems();
    const items = rawItems.map(migrateItem);
    const settings = this.loadSettingsSync();
    return { items, settings };
  }

  async loadAll(): Promise<{ items: ContentItem[]; settings: CurateSettings }> {
    return this.loadAllSync();
  }

  async saveItem(item: ContentItem): Promise<boolean> {
    const migrated = migrateItem({
      ...item,
      updatedAt: item.updatedAt || new Date().toISOString(),
    });
    const current = getStoredItems();
    const existingIndex = current.findIndex((it) => it.id === item.id);
    let next: ContentItem[];
    if (existingIndex >= 0) {
      next = [...current];
      next[existingIndex] = migrated;
    } else {
      next = [migrated, ...current];
    }
    return saveStoredItems(next);
  }

  async saveItems(items: ContentItem[]): Promise<boolean> {
    const migrated = items.map((it) =>
      migrateItem({
        ...it,
        updatedAt: it.updatedAt || new Date().toISOString(),
      })
    );
    return saveStoredItems(migrated);
  }

  async deleteItem(id: string): Promise<boolean> {
    const current = getStoredItems();
    const target = current.find((it) => it.id === id);
    if (target && target.screenshots) {
      for (const shot of target.screenshots) {
        if (isMediaReference(shot)) {
          await this.deleteMedia(shot);
        }
      }
    }
    const next = current.filter((it) => it.id !== id);
    return saveStoredItems(next);
  }

  loadSettingsSync(): CurateSettings {
    const dayThemes = getStoredDayThemes();
    const customTopics = getStoredCustomTopics();
    const dayPreferencesEnabled = getStoredDayPreferencesEnabled();

    // Collect stored week budgets
    const weekBudgets: Record<string, { availableMinutes: number; preset: BudgetPreset }> = {};
    try {
      if (typeof localStorage !== 'undefined') {
        const prefix = 'curatecal_week_budget_';
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix)) {
            const weekKey = key.slice(prefix.length);
            const raw = localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed.availableMinutes === 'number') {
                weekBudgets[weekKey] = parsed;
              }
            }
          }
        }
      }
    } catch {
      // Ignore
    }

    let darkMode: boolean | undefined = undefined;
    try {
      if (typeof localStorage !== 'undefined') {
        const dm = localStorage.getItem('curatecal_dark_mode');
        if (dm !== null) darkMode = dm === 'true';
      }
    } catch {
      // Ignore
    }

    return {
      dayThemes,
      customTopics,
      weekBudgets,
      dayPreferencesEnabled,
      brandName: getCustomBrandName(),
      brandLogo: getCustomBrandLogo(),
      darkMode,
    };
  }

  async loadSettings(): Promise<CurateSettings> {
    return this.loadSettingsSync();
  }

  getWeekBudget(weekKey: string): { availableMinutes: number; preset: BudgetPreset } {
    return getStoredWeekBudget(weekKey);
  }

  saveWeekBudget(weekKey: string, availableMinutes: number, preset: BudgetPreset): void {
    saveStoredWeekBudget(weekKey, availableMinutes, preset);
  }

  getDayPreferencesEnabled(): boolean {
    return getStoredDayPreferencesEnabled();
  }

  saveDayPreferencesEnabled(enabled: boolean): void {
    saveStoredDayPreferencesEnabled(enabled);
  }

  addCustomTopic(topic: string): string[] {
    return saveCustomTopic(topic);
  }

  clearAllItems(): void {
    clearStoredItems();
  }

  async saveSettings(settings: Partial<CurateSettings>): Promise<boolean> {
    try {
      if (settings.dayThemes) {
        saveStoredDayThemes(settings.dayThemes);
      }
      if (settings.customTopics && typeof localStorage !== 'undefined') {
        localStorage.setItem('curatecal_custom_topics_v1', JSON.stringify(settings.customTopics));
      }
      if (settings.dayPreferencesEnabled !== undefined) {
        saveStoredDayPreferencesEnabled(settings.dayPreferencesEnabled);
      }
      if (settings.weekBudgets && typeof localStorage !== 'undefined') {
        for (const [weekKey, budget] of Object.entries(settings.weekBudgets)) {
          localStorage.setItem(`curatecal_week_budget_${weekKey}`, JSON.stringify(budget));
        }
      }
      if (settings.brandName !== undefined) {
        saveCustomBrandName(settings.brandName);
      }
      if (settings.brandLogo !== undefined) {
        saveCustomBrandLogo(settings.brandLogo);
      }
      if (settings.darkMode !== undefined && typeof localStorage !== 'undefined') {
        localStorage.setItem('curatecal_dark_mode', String(settings.darkMode));
      }
      return true;
    } catch {
      return false;
    }
  }

  async exportSnapshot(): Promise<DataSnapshot> {
    const { items, settings } = await this.loadAll();

    // Collect all image references across items & settings (never raw base64)
    const imageRefs = new Set<string>();
    for (const it of items) {
      if (it.screenshots) {
        for (const shot of it.screenshots) {
          if (isMediaReference(shot)) {
            imageRefs.add(shot);
          }
        }
      }
      if (it.thumbnailUrl && isMediaReference(it.thumbnailUrl)) {
        imageRefs.add(it.thumbnailUrl);
      }
    }
    if (settings.brandLogo && isMediaReference(settings.brandLogo)) {
      imageRefs.add(settings.brandLogo);
    }

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      appName: APP_NAME,
      itemCount: items.length,
      items,
      settings,
      imageRefs: Array.from(imageRefs),
    };
  }

  async importSnapshot(snapshot: DataSnapshot): Promise<boolean> {
    if (!snapshot || !Array.isArray(snapshot.items)) {
      return false;
    }
    try {
      // Migrate each item to guarantee valid schema and updatedAt
      const migratedItems = snapshot.items.map(migrateItem);
      const saved = saveStoredItems(migratedItems);
      if (!saved) return false;

      if (snapshot.settings) {
        await this.saveSettings(snapshot.settings);
      }
      return true;
    } catch {
      return false;
    }
  }

  async saveMedia(id: string, dataUrl: string): Promise<string> {
    return saveMediaItem(id, dataUrl);
  }

  async getMedia(refOrId: string): Promise<string | null> {
    return getMediaItem(refOrId);
  }

  getMediaSync(refOrId: string): string | null {
    return getMediaItemSync(refOrId);
  }

  async deleteMedia(refOrId: string): Promise<void> {
    return deleteMediaItem(refOrId);
  }
}

// Global singleton instance conforming to DataStore
export const localStore: LocalStore = new LocalStore();

let activeDataStore: DataStore = localStore;

export function setActiveDataStore(store: DataStore): void {
  activeDataStore = store;
}

export function getDataStore(): DataStore {
  return activeDataStore;
}
