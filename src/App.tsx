import { cloudStore, isSupabaseConfigured } from './lib/cloudStore';
import { AuthModal } from './components/AuthModal';
import { AccountMenuModal } from './components/AccountMenuModal';
import { FirstSignInMigrationModal } from './components/FirstSignInMigrationModal';
import { SyncConflictModal } from './components/SyncConflictModal';
import { PrivacyPolicyModal } from './components/PrivacyPolicyModal';
import { TermsOfServiceModal } from './components/TermsOfServiceModal';
import { SnapshotConflict, mergeSnapshots } from './lib/dataStore';
import type { User } from '@supabase/supabase-js';
import React, { useState, useEffect, useMemo } from 'react';
import {
  CalendarView,
  ContentItem,
  ContentType,
  DayTheme,
  APP_NAME,
} from './types';
import {
  getStoredItems,
  saveStoredItems,
  getStoredDayThemes,
  getStoredCustomTopics,
  saveCustomTopic,
  generateCuratedStarterPack,
  clearStoredItems,
  getStorageFailureInfo,
  StorageFailureInfo,
  exportBackupJson,
} from './lib/storage';
import { getDataStore, setActiveDataStore, localStore } from './lib/dataStore';
import { TopNav } from './components/TopNav';
import { HomePage } from './components/HomePage';
import { CalendarGrid } from './components/CalendarGrid';
import { InboxDrawer } from './components/InboxDrawer';
import { AddContentModal } from './components/AddContentModal';
import { ContentDetailModal } from './components/ContentDetailModal';
import { SearchModal } from './components/SearchModal';
import { DayDrawer } from './components/DayDrawer';
import { SettingsBackupModal } from './components/SettingsBackupModal';
import {
  recordActivationSave,
  recordActivationScheduled,
  recordActivationCalendarViewed,
  recordActivationPlanMyWeek,
} from './lib/activation';
import {
  enrichItemWithYouTubeDuration,
  isDurationUserEdited,
} from './lib/youtubeDuration';
import { RotateCcw, X, AlertCircle, Download, Laptop } from 'lucide-react';
import { calculateTimeForMonth, calculateTimeForDate } from './lib/timeAccounting';
import { toDateStr, getOffsetDateStr, getTodayStr, getWeekDates } from './lib/dateUtils';
import { QuickPlanModal } from './components/QuickPlanModal';
import { WeeklyReviewModal } from './components/WeeklyReviewModal';
import { ShareWeekModal } from './components/ShareWeekModal';
import { AnalyticsNoticeBanner } from './components/AnalyticsNoticeBanner';
import { trackEvent } from './lib/analytics';
import { MultiSelectToolbar } from './components/MultiSelectToolbar';
import { CreateCollectionModal } from './components/CreateCollectionModal';
import { CollectionsView } from './components/CollectionsView';
import {
  getStoredCollections,
  importCollectionItemsToInbox,
  fetchCollectionFromServer,
  updateCollectionOnServer,
  createCollectionSnapshot,
  SharedCollectionRecord,
} from './lib/collections';
import { fetchYouTubeDurationsBatch } from './lib/youtubeDuration';
import { extractYouTubeId } from './lib/metadataExtractor';
import { Check } from 'lucide-react';

export default function App() {
  const [items, setItems] = useState<ContentItem[]>(() => {
    return getDataStore().loadAllSync ? getDataStore().loadAllSync!().items : getStoredItems();
  });
  const [dayThemes] = useState<DayTheme[]>(() => {
    return getDataStore().loadSettingsSync ? getDataStore().loadSettingsSync!().dayThemes : getStoredDayThemes();
  });
  const [availableTopics, setAvailableTopics] = useState<string[]>(() => {
    return getDataStore().loadSettingsSync ? getDataStore().loadSettingsSync!().customTopics : getStoredCustomTopics();
  });

  // App opened event: fires exactly once on startup
  useEffect(() => {
    document.title = 'Curate — Curate Your Curiosity.';
    trackEvent('app_opened');
  }, []);

  // Primary tab: 'home' (Cosmos discovery & visual library), 'calendar' (schedule), or 'collections' (public boards)
  const [activeTab, setActiveTab] = useState<'home' | 'calendar' | 'collections'>(() => {
    return 'home';
  });

  // Collections & Multi-Select state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [isCreateCollectionOpen, setIsCreateCollectionOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<SharedCollectionRecord | null>(null);
  const [userCollections, setUserCollections] = useState<SharedCollectionRecord[]>(() => getStoredCollections());
  const [collectionToastMessage, setCollectionToastMessage] = useState<string | null>(null);

  const handleToggleSelectItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 50) return next;
        next.add(id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedItemIds(new Set());
  };

  const loadUserCollections = () => {
    setUserCollections(getStoredCollections());
  };

  const handleAddItemToCollection = async (collectionId: string, itemToAdd: ContentItem) => {
    try {
      const col = userCollections.find((c) => c.id === collectionId);
      if (!col) return;

      const alreadyExists = col.items.some((i) => i.id === itemToAdd.id);
      if (alreadyExists) {
        setCollectionToastMessage(`"${itemToAdd.title}" is already in "${col.title}".`);
        return;
      }

      if (col.items.length >= 50) {
        setCollectionToastMessage(`Collection "${col.title}" is at the maximum limit of 50 items.`);
        return;
      }

      const updatedRawItems: ContentItem[] = [
        ...col.items.map((ci) => {
          const match = items.find((i) => i.id === ci.id);
          return (
            match || {
              id: ci.id,
              title: ci.title,
              source: ci.source,
              contentType: (ci.type as ContentType) || 'other',
              durationMinutes: ci.duration,
              durationIsEstimate: ci.durationIsEstimate,
              thumbnailUrl: ci.coverReference || '',
              url: ci.url,
              status: 'inbox' as const,
              createdAt: col.createdAt,
            }
          );
        }),
        itemToAdd,
      ];

      const snapshot = createCollectionSnapshot({
        id: col.id,
        userId: col.userId || currentUser?.id || 'guest-user',
        title: col.title,
        description: col.description,
        displayName: col.displayName || (currentUser?.email ? currentUser.email.split('@')[0] : undefined),
        items: updatedRawItems,
        allowSearchEngines: col.allowSearchEngines,
      });

      await updateCollectionOnServer(col.id, {
        items: snapshot.items as any,
        totalDurationMinutes: snapshot.totalDurationMinutes,
      });

      loadUserCollections();
      setCollectionToastMessage(`Added "${itemToAdd.title}" to collection "${col.title}"!`);
    } catch (err) {
      console.error('Failed to add item to collection:', err);
      setCollectionToastMessage('Failed to add item to collection.');
    }
  };

  const handleAddSelectedToCollection = async (collectionId: string) => {
    try {
      const col = userCollections.find((c) => c.id === collectionId);
      if (!col) return;

      const itemsToAdd = items.filter((it) => selectedItemIds.has(it.id));
      if (itemsToAdd.length === 0) return;

      const existingIds = new Set(col.items.map((i) => i.id));
      const newItems = itemsToAdd.filter((it) => !existingIds.has(it.id));

      if (newItems.length === 0) {
        setCollectionToastMessage(`Selected items are already in "${col.title}".`);
        return;
      }

      if (col.items.length + newItems.length > 50) {
        setCollectionToastMessage(`Cannot add ${newItems.length} items. Maximum collection size is 50.`);
        return;
      }

      const updatedRawItems: ContentItem[] = [
        ...col.items.map((ci) => {
          const match = items.find((i) => i.id === ci.id);
          return (
            match || {
              id: ci.id,
              title: ci.title,
              source: ci.source,
              contentType: (ci.type as ContentType) || 'other',
              durationMinutes: ci.duration,
              durationIsEstimate: ci.durationIsEstimate,
              thumbnailUrl: ci.coverReference || '',
              url: ci.url,
              status: 'inbox' as const,
              createdAt: col.createdAt,
            }
          );
        }),
        ...newItems,
      ];

      const snapshot = createCollectionSnapshot({
        id: col.id,
        userId: col.userId || currentUser?.id || 'guest-user',
        title: col.title,
        description: col.description,
        displayName: col.displayName || (currentUser?.email ? currentUser.email.split('@')[0] : undefined),
        items: updatedRawItems,
        allowSearchEngines: col.allowSearchEngines,
      });

      await updateCollectionOnServer(col.id, {
        items: snapshot.items as any,
        totalDurationMinutes: snapshot.totalDurationMinutes,
      });

      loadUserCollections();
      handleClearSelection();
      setCollectionToastMessage(`Added ${newItems.length} items to "${col.title}"!`);
    } catch (err) {
      console.error('Failed to add selected items to collection:', err);
      setCollectionToastMessage('Failed to add items to collection.');
    }
  };

  // Date navigation
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [view, setView] = useState<CalendarView>('month');

  const handleViewChange = (newView: CalendarView) => {
    setView(newView);
    trackEvent('calendar_viewed', { view: newView });
  };

  // Dark mode (default to dark mode on first launch when no saved preference exists)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('curatecal_dark_mode');
        if (saved !== null) return saved === 'true';
      }
    } catch {
      // Ignore
    }
    return true;
  });

  // Inbox side shelf state
  const [isInboxOpen, setIsInboxOpen] = useState(false);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [dayDrawerDate, setDayDrawerDate] = useState<string | null>(null);
  const [addModalInitialDate, setAddModalInitialDate] = useState<string | undefined>(undefined);
  const [addModalInitialType, setAddModalInitialType] = useState<ContentType | undefined>(undefined);
  const [addModalInitialCollectionId, setAddModalInitialCollectionId] = useState<string | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Cloud Auth & Modals
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [syncConflicts, setSyncConflicts] = useState<SnapshotConflict[]>([]);

  // Listen to Supabase Auth state changes
  useEffect(() => {
    const unsubscribe = cloudStore.onAuthStateChange(async (user) => {
      setCurrentUser(user);

      if (user) {
        // 1. Export local state BEFORE switching to cloudStore
        const localSnapshot = await localStore.exportSnapshot();
        const localItems = localStore.loadAllSync().items;

        // 2. Now it is safe to set the active store to cloudStore
        setActiveDataStore(cloudStore);

        // 3. Handle guest migration if this is their first sign-in
        const nonSampleCount = localItems.filter((i) => !i.isSample).length;
        const migrationDone = localStorage.getItem('curate_migrated_' + user.id);

        if (nonSampleCount > 0 && !migrationDone) {
          setIsMigrationModalOpen(true);
        } else {
          // Perform cloud load and merge with local
          try {
            const cloudSnapshot = await cloudStore.exportSnapshot();
            const merge = mergeSnapshots(localSnapshot, cloudSnapshot);
            if (merge.conflicts.length > 0) {
              setSyncConflicts(merge.conflicts);
            }
            // 4. Update UI state and push merged result to active store (cloudStore)
            setItems(merge.mergedSnapshot.items);
            await cloudStore.saveItems(merge.mergedSnapshot.items);
          } catch (err) {
            console.warn('[CloudSync] Initial sync error:', err);
          }
        }
      } else {
        // Logged out: fall back to local store
        setActiveDataStore(localStore);
        // Refresh items from local storage to hide cloud data
        const localData = localStore.loadAllSync();
        setItems(localData.items);
      }
    });
    return () => unsubscribe();
  }, []);

  const performImportCollection = async (collectionId: string) => {
    try {
      const col = await fetchCollectionFromServer(collectionId);
      if (!col || !col.items || col.items.length === 0) {
        setCollectionToastMessage('Collection not found or has no items.');
        return;
      }

      const currentItems = getDataStore().loadAllSync ? getDataStore().loadAllSync!().items : getStoredItems();
      const { newItems, skippedDuplicatesCount } = importCollectionItemsToInbox(col.items, currentItems);

      if (newItems.length > 0) {
        const updated = [...newItems, ...currentItems];
        setItems(updated);
        saveStoredItems(updated);

        // Refetch YouTube durations fresh for newly imported items (do not copy cached YouTube data)
        const ytIds = newItems
          .filter((i) => i.contentType === 'youtube' && i.url)
          .map((i) => extractYouTubeId(i.url || ''))
          .filter((id): id is string => Boolean(id));
        if (ytIds.length > 0) {
          fetchYouTubeDurationsBatch(ytIds).catch(() => {});
        }

        // Requirement 7: collection_saved event with itemCount
        trackEvent('collection_saved', { itemCount: newItems.length });

        setCollectionToastMessage(
          `Added ${newItems.length} ${newItems.length === 1 ? 'item' : 'items'} to your Inbox${
            skippedDuplicatesCount > 0 ? ` (${skippedDuplicatesCount} duplicates skipped)` : ''
          }`
        );

        // Open Inbox so user sees the newly imported items
        setIsInboxOpen(true);
      } else {
        setCollectionToastMessage(
          `All ${col.items.length} items in this collection already exist in your library.`
        );
      }

      // Clean URL params and clear pending storage
      if (typeof window !== 'undefined') {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        sessionStorage.removeItem('curate_pending_import_collection');
      }
    } catch (err) {
      console.error('Failed to import collection:', err);
      setCollectionToastMessage('Failed to save collection to your Inbox.');
    }
  };

  // Check URL params on startup or auth state change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const importId =
      urlParams.get('import_collection') ||
      urlParams.get('collection') ||
      sessionStorage.getItem('curate_pending_import_collection');

    if (!importId) return;

    if (!currentUser) {
      // Requirement 2: 'Save to my Curate' requires an account.
      sessionStorage.setItem('curate_pending_import_collection', importId);
      setCollectionToastMessage('Please sign in or create an account to save this collection to your Inbox.');
      setIsAuthModalOpen(true);
    } else {
      performImportCollection(importId);
    }
  }, [currentUser]);

  // Desktop notice for viewports below 900px
  const [isDesktopNoticeDismissed, setIsDesktopNoticeDismissed] = useState<boolean>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('curate_desktop_notice_dismissed') === 'true';
      }
    } catch {
      // Ignore
    }
    return false;
  });

  const [isBelow900, setIsBelow900] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 900;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setIsBelow900(window.innerWidth < 900);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleDismissDesktopNotice = () => {
    setIsDesktopNoticeDismissed(true);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('curate_desktop_notice_dismissed', 'true');
      }
    } catch {
      // Ignore
    }
  };

  // Quick Plan Modal state & preset budget
  const [isQuickPlanOpen, setIsQuickPlanOpen] = useState(false);
  const [quickPlanBudgetMinutes, setQuickPlanBudgetMinutes] = useState<number>(120);

  const handleOpenQuickPlan = (presetMinutes?: number) => {
    setQuickPlanBudgetMinutes(presetMinutes ?? 120);
    setIsQuickPlanOpen(true);
    trackEvent('quick_plan_opened');
  };

  // Weekly Review Modal state
  const [isWeeklyReviewOpen, setIsWeeklyReviewOpen] = useState(false);
  const [isShareWeekOpen, setIsShareWeekOpen] = useState(false);

  const handlePlanNextWeekFromReview = () => {
    setIsWeeklyReviewOpen(false);
    setActiveTab('calendar');
    trackEvent('calendar_viewed', { view: 'week' });
    setView('week');
    handleOpenQuickPlan(quickPlanBudgetMinutes);
  };

  // Quick Plan Undo state & timer
  const [quickPlanUndoState, setQuickPlanUndoState] = useState<{
    previousItems: ContentItem[];
    message: string;
  } | null>(null);

  // Storage failure safe mode tracking
  const [storageFailure, setStorageFailure] = useState<StorageFailureInfo | null>(() =>
    getStorageFailureInfo()
  );

  useEffect(() => {
    const handleStorageError = (e: any) => {
      setStorageFailure({
        hasFailed: true,
        errorMessage: e.detail?.error || 'Browser storage is full (quota exceeded).',
        failedAt: new Date().toISOString(),
        failedOperation: e.detail?.operation || 'save',
      });
    };

    const handleStorageRecovered = () => {
      setStorageFailure(null);
    };

    window.addEventListener('curatecal:storage_error', handleStorageError);
    window.addEventListener('curatecal:storage_recovered', handleStorageRecovered);
    return () => {
      window.removeEventListener('curatecal:storage_error', handleStorageError);
      window.removeEventListener('curatecal:storage_recovered', handleStorageRecovered);
    };
  }, []);

  const handleExportBackup = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `curatecal-backup-${getTodayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!quickPlanUndoState) return;
    const timer = setTimeout(() => {
      setQuickPlanUndoState(null);
    }, 12000);
    return () => clearTimeout(timer);
  }, [quickPlanUndoState]);

  // Dark mode sync
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark');
      localStorage.setItem('curatecal_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.remove('dark');
      localStorage.setItem('curatecal_dark_mode', 'false');
    }
  }, [darkMode]);

  // Global keyboard shortcuts (⌘K for search, ⌘N for add)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setAddModalInitialDate(undefined);
        setIsAddModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Save changes to storage
  const handleSaveItems = (newItems: ContentItem[]) => {
    setItems(newItems);
    const store = getDataStore();
    if (store.saveItems) {
      store.saveItems(newItems);
    } else {
      saveStoredItems(newItems);
    }
  };

  // Add Item
  const handleAddItem = (
    newItemData: Omit<ContentItem, 'id' | 'createdAt'>,
    method: 'paste' | 'quick_add' | 'sample' = 'paste',
    targetCollectionId?: string
  ) => {
    const effectiveMethod = newItemData.isSample ? 'sample' : method;
    const newItem: ContentItem = {
      ...newItemData,
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    const updated = [newItem, ...items];
    handleSaveItems(updated);

    if (targetCollectionId) {
      handleAddItemToCollection(targetCollectionId, newItem);
    }

    trackEvent('item_added', {
      type: newItem.contentType,
      method: effectiveMethod,
    });

    if (newItem.scheduledDate) {
      trackEvent('item_planned', {
        method: effectiveMethod === 'paste' ? 'modal' : 'quick_add',
      });
    }

    // Activation milestone tracking: sample items never count toward activation
    const activeCount = updated.filter((i) => !i.isSample && i.status !== 'completed').length;
    if (!newItem.isSample) {
      recordActivationSave(activeCount, undefined, newItem.contentType, false);
      if (newItem.scheduledDate) {
        recordActivationScheduled(newItem.id, newItem.scheduledDate, undefined, false);
      }
    }

    // Enrich YouTube link with real duration if available (never blocks saving)
    if (newItem.url && !isDurationUserEdited(newItem)) {
      enrichItemWithYouTubeDuration(newItem)
        .then((enriched) => {
          if (enriched.durationMinutes && enriched.durationIsEstimate === false) {
            setItems((prev) => {
              const next = prev.map((it) => (it.id === newItem.id ? enriched : it));
              saveStoredItems(next);
              return next;
            });
          }
        })
        .catch(() => {
          // Keep estimate on any failure
        });
    }
  };

  // Add Item to a specific date from drag
  const handleAddNewItemToDate = (
    itemData: Omit<ContentItem, 'id' | 'createdAt'>,
    targetDateStr: string
  ) => {
    const newItem: ContentItem = {
      ...itemData,
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      status: 'planned',
      scheduledDate: targetDateStr,
      createdAt: new Date().toISOString(),
    };
    const updated = [newItem, ...items];
    handleSaveItems(updated);

    trackEvent('item_added', {
      type: newItem.contentType,
      method: 'quick_add',
    });
    trackEvent('item_planned', {
      method: 'drag',
    });

    const activeCount = updated.filter((i) => !i.isSample && i.status !== 'completed').length;
    if (!newItem.isSample) {
      recordActivationSave(activeCount, undefined, newItem.contentType, false);
      recordActivationScheduled(newItem.id, targetDateStr, undefined, false);
    }

    // Enrich YouTube link with real duration if available (never blocks saving)
    if (newItem.url && !isDurationUserEdited(newItem)) {
      enrichItemWithYouTubeDuration(newItem)
        .then((enriched) => {
          if (enriched.durationMinutes && enriched.durationIsEstimate === false) {
            setItems((prev) => {
              const next = prev.map((it) => (it.id === newItem.id ? enriched : it));
              saveStoredItems(next);
              return next;
            });
          }
        })
        .catch(() => {
          // Keep estimate on any failure
        });
    }
  };

  // Update Item
  const handleUpdateItem = (
    id: string,
    updates: Partial<ContentItem>,
    method?: 'drag' | 'quick_move' | 'quick_plan' | 'modal'
  ) => {
    const target = items.find((it) => it.id === id);
    const isDurationChanged =
      updates.durationMinutes !== undefined &&
      updates.durationMinutes !== target?.durationMinutes;

    const mergedUpdates: Partial<ContentItem> = {
      ...updates,
      ...(isDurationChanged
        ? {
            durationIsEstimate: false,
            userEditedFields: Array.from(
              new Set([
                ...(target?.userEditedFields || []),
                ...(target?.editedFields || []),
                'durationMinutes',
              ])
            ),
            editedFields: Array.from(
              new Set([
                ...(target?.userEditedFields || []),
                ...(target?.editedFields || []),
                'durationMinutes',
              ])
            ),
          }
        : {}),
    };

    const updated = items.map((it) => (it.id === id ? { ...it, ...mergedUpdates } : it));
    handleSaveItems(updated);

    if (isDurationChanged && target) {
      trackEvent('duration_edited', {
        type: target.contentType,
        wasEstimate: target.durationIsEstimate !== false,
      });
    }

    if (updates.scheduledDate && updates.scheduledDate !== target?.scheduledDate) {
      trackEvent('item_planned', {
        method: method || 'modal',
      });
    }

    if (updates.status === 'completed' && target?.status !== 'completed') {
      trackEvent('item_completed');
    }

    if (updates.scheduledDate && (!target || !target.isSample)) {
      recordActivationScheduled(id, updates.scheduledDate, undefined, false);
    }
    if (selectedItem && selectedItem.id === id) {
      setSelectedItem((prev) => (prev ? { ...prev, ...mergedUpdates } : null));
    }
  };

  // Dedicated one-tap duration updater
  const handleUpdateDuration = (id: string, durationMinutes: number) => {
    const target = items.find((it) => it.id === id);
    if (!target) return;
    const wasEstimate = target.durationIsEstimate !== false;

    const currentEdited = new Set([
      ...(target.userEditedFields || []),
      ...(target.editedFields || []),
      'durationMinutes',
    ]);
    const fields = Array.from(currentEdited);

    const updated = items.map((it) =>
      it.id === id
        ? {
            ...it,
            durationMinutes,
            durationIsEstimate: false,
            userEditedFields: fields,
            editedFields: fields,
          }
        : it
    );
    handleSaveItems(updated);

    if (selectedItem && selectedItem.id === id) {
      setSelectedItem((prev) =>
        prev
          ? {
              ...prev,
              durationMinutes,
              durationIsEstimate: false,
              userEditedFields: fields,
              editedFields: fields,
            }
          : null
      );
    }

    trackEvent('duration_edited', {
      type: target.contentType,
      wasEstimate,
    });
  };

  // Delete Item
  const handleDeleteItem = (id: string) => {
    const updated = items.filter((it) => it.id !== id);
    handleSaveItems(updated);
    if (selectedItem && selectedItem.id === id) {
      setSelectedItem(null);
    }
  };

  // One-click toggle completion
  const handleToggleComplete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = items.find((it) => it.id === id);
    if (!target) return;
    const isNowCompleted = target.status !== 'completed';
    handleUpdateItem(id, {
      status: isNowCompleted ? 'completed' : 'planned',
      completedAt: isNowCompleted ? new Date().toISOString() : undefined,
    });
  };

  // One-click toggle priority
  const handleTogglePriority = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = items.find((it) => it.id === id);
    if (!target) return;
    handleUpdateItem(id, {
      isPriority: !target.isPriority,
    });
  };

  // Apply Quick Plan schedule with full undo snapshot
  const handleApplyQuickPlan = (assignments: { itemId: string; targetDateStr: string }[]) => {
    if (assignments.length === 0) return;
    const assignmentMap = new Map(assignments.map((a) => [a.itemId, a.targetDateStr]));
    const previous = [...items];
    const updated = items.map((it) => {
      const targetDate = assignmentMap.get(it.id);
      if (targetDate) {
        return {
          ...it,
          scheduledDate: targetDate,
          status: 'planned' as const,
        };
      }
      return it;
    });
    handleSaveItems(updated);
    assignments.forEach(() => {
      trackEvent('item_planned', { method: 'quick_plan' });
    });
    trackEvent('quick_plan_applied');
    setQuickPlanUndoState({
      previousItems: previous,
      message: `Quick Plan scheduled ${assignments.length} item${assignments.length === 1 ? '' : 's'}.`,
    });
  };

  // Undo Quick Plan changes
  const handleUndoQuickPlan = () => {
    if (!quickPlanUndoState) return;
    handleSaveItems(quickPlanUndoState.previousItems);
    setQuickPlanUndoState(null);
    trackEvent('quick_plan_undone');
  };

  // Move item to date
  const handleMoveItemToDate = (
    itemId: string,
    targetDateStr: string,
    method: 'drag' | 'quick_move' | 'quick_plan' | 'modal' = 'quick_move'
  ) => {
    const target = items.find((it) => it.id === itemId);
    if (!target) return;
    handleUpdateItem(
      itemId,
      {
        scheduledDate: targetDateStr,
        status: target.status === 'inbox' ? 'planned' : target.status,
      },
      method
    );
    recordActivationScheduled(itemId, targetDateStr, undefined);
  };

  // Move item to Inbox
  const handleMoveToInbox = (itemId: string) => {
    handleUpdateItem(itemId, {
      scheduledDate: undefined,
      status: 'inbox',
    });
  };

  // Plan my week: auto-schedules up to 3 unscheduled items across upcoming days and opens Calendar
  const handlePlanMyWeek = () => {
    const unscheduled = items.filter(
      (it) => it.status !== 'completed' && (!it.scheduledDate || it.status === 'inbox')
    );
    const today = new Date();

    const updated = items.map((it) => {
      const idx = unscheduled.findIndex((u) => u.id === it.id);
      if (idx >= 0 && idx < 3) {
        return {
          ...it,
          status: 'planned' as const,
          scheduledDate: getOffsetDateStr(idx, today),
        };
      }
      return it;
    });

    handleSaveItems(updated);
    const userUnscheduledCount = unscheduled.filter((u) => !u.isSample).length;
    recordActivationPlanMyWeek(Math.min(3, userUnscheduledCount));
    setActiveTab('calendar');
    trackEvent('calendar_viewed', { view });
    recordActivationCalendarViewed('plan_my_week');
  };

  // Tab change with activation calendar viewed tracking
  const handleTabChange = (tab: 'home' | 'calendar' | 'collections') => {
    setActiveTab(tab);
    if (tab === 'calendar') {
      recordActivationCalendarViewed('nav');
      trackEvent('calendar_viewed', { view });
    }
  };

  // Add for date
  const handleAddForDate = (dateStr: string) => {
    setAddModalInitialDate(dateStr);
    setIsAddModalOpen(true);
  };

  // Custom Topic
  const handleAddCustomTopic = (newTopic: string) => {
    const store = getDataStore();
    const updated = store.addCustomTopic ? store.addCustomTopic(newTopic) : saveCustomTopic(newTopic);
    if (Array.isArray(updated)) {
      setAvailableTopics(updated);
    }
  };

  // Load starter collection
  const handleLoadStarterPack = () => {
    const starters = generateCuratedStarterPack();
    handleSaveItems(starters);
    starters.forEach((s) => {
      trackEvent('item_added', { type: s.contentType, method: 'sample' });
    });
  };

  // Navigation
  const handlePrev = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (view === 'month') {
        d.setMonth(d.getMonth() - 1);
      } else if (view === 'week') {
        d.setDate(d.getDate() - 7);
      } else {
        d.setDate(d.getDate() - 1);
      }
      return d;
    });
  };

  const handleNext = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (view === 'month') {
        d.setMonth(d.getMonth() + 1);
      } else if (view === 'week') {
        d.setDate(d.getDate() + 7);
      } else {
        d.setDate(d.getDate() + 1);
      }
      return d;
    });
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Unscheduled items
  const inboxItems = useMemo(() => {
    return items.filter((it) => it.status === 'inbox');
  }, [items]);

  // Total scheduled duration using unified counting rule
  const { plannedMinutes: monthPlannedMinutes, completedMinutes: monthCompletedMinutes } = useMemo(() => {
    return calculateTimeForMonth(items, currentDate.getFullYear(), currentDate.getMonth());
  }, [items, currentDate]);

  // Week calculations for Quick Plan
  const currentWeekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);
  const currentWeekDateSet = useMemo(() => new Set(currentWeekDates.map((w) => w.dateStr)), [currentWeekDates]);
  const existingWeekItems = useMemo(() => {
    return items.filter((it) => it.scheduledDate && currentWeekDateSet.has(it.scheduledDate));
  }, [items, currentWeekDateSet]);

  const weekDaySlots = useMemo(() => {
    return currentWeekDates.map((wd) => {
      const dayMetrics = calculateTimeForDate(items, wd.dateStr);
      const theme = dayThemes.find((t) => t.dayOfWeek === wd.date.getDay());
      return {
        dateStr: wd.dateStr,
        date: wd.date,
        dayOfWeek: wd.date.getDay(),
        dayName: wd.date.toLocaleDateString('en-US', { weekday: 'long' }),
        themeTopic: theme?.enabled ? theme.topic : undefined,
        currentPlannedMinutes: dayMetrics.plannedMinutes,
      };
    });
  }, [currentWeekDates, items, dayThemes]);

  return (
    <div className={`min-h-screen bg-[#FAF9F6] dark:bg-[#0C0C0C] text-stone-900 dark:text-stone-100 flex flex-col font-sans transition-colors selection:bg-stone-200 dark:selection:bg-stone-800 ${
      darkMode ? 'dark' : ''
    }`}>
      {/* Below 900px Desktop Notice Banner */}
      {!isDesktopNoticeDismissed && isBelow900 && (
        <aside
          role="note"
          aria-label="Desktop notice"
          className="bg-amber-50/90 dark:bg-stone-900 border-b border-amber-200/70 dark:border-stone-850 text-stone-800 dark:text-stone-200 px-4 py-2 text-xs font-sans flex items-center justify-between gap-3 shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Laptop className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="leading-snug">
              Curate is built for desktop right now. Open it on a laptop for the full experience.
            </span>
          </div>
          <button
            type="button"
            onClick={handleDismissDesktopNotice}
            title="Dismiss notice"
            aria-label="Dismiss notice"
            className="p-1 rounded-md text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-amber-100/70 dark:hover:bg-stone-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </aside>
      )}

      {/* Cosmos-Style Minimal Header */}
      <TopNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        currentDate={currentDate}
        view={view}
        onViewChange={handleViewChange}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        inboxCount={inboxItems.length}
        monthPlannedMinutes={monthPlannedMinutes}
        monthCompletedMinutes={monthCompletedMinutes}
        totalMonthlyMinutes={monthPlannedMinutes}
        onOpenAddModal={() => {
          setAddModalInitialDate(undefined);
          setIsAddModalOpen(true);
        }}
        onToggleInbox={() => setIsInboxOpen(!isInboxOpen)}
        isInboxOpen={isInboxOpen}
        onOpenSearch={() => setIsSearchOpen(true)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWeeklyReview={() => setIsWeeklyReviewOpen(true)}
                onOpenShareWeek={() => setIsShareWeekOpen(true)}
        currentUser={currentUser ? { id: currentUser.id, email: currentUser.email } : null}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenAccountMenu={() => setIsAccountMenuOpen(true)}
      />

      {/* Main Container: Home (Cosmos landing & library) vs Calendar (Schedule) */}
      <div className="flex-1 flex overflow-x-hidden">
        <main className="flex-1 flex flex-col min-w-0">
          {activeTab === 'home' ? (
            <HomePage
              items={items}
              onAddItem={handleAddItem}
              onUpdateItem={handleUpdateItem}
              onSelectCard={setSelectedItem}
              onToggleComplete={handleToggleComplete}
              onTogglePriority={handleTogglePriority}
              onNavigateToCalendar={() => handleTabChange('calendar')}
              onPlanMyWeek={handlePlanMyWeek}
              onLoadStarterPack={handleLoadStarterPack}
              onOpenAddModal={(type?: ContentType) => {
                setAddModalInitialType(type);
                setAddModalInitialDate(undefined);
                setIsAddModalOpen(true);
              }}
              selectedItemIds={selectedItemIds}
              onToggleSelectItem={handleToggleSelectItem}
            />
          ) : activeTab === 'calendar' ? (
            <div className="flex-1 py-2">
              <CalendarGrid
                currentDate={currentDate}
                view={view}
                items={items}
                dayThemes={dayThemes}
                onSelectCard={setSelectedItem}
                onToggleComplete={handleToggleComplete}
                onTogglePriority={handleTogglePriority}
                onMoveItemToDate={handleMoveItemToDate}
                onAddNewItemToDate={handleAddNewItemToDate}
                onAddForDate={handleAddForDate}
                onOpenDayDrawer={(dStr) => setDayDrawerDate(dStr)}
                onDateChange={setCurrentDate}
                onViewChange={handleViewChange}
                inboxItems={inboxItems}
                onApplyQuickPlan={handleApplyQuickPlan}
                onOpenQuickPlan={handleOpenQuickPlan}
                onOpenWeeklyReview={() => setIsWeeklyReviewOpen(true)}
                onOpenShareWeek={() => setIsShareWeekOpen(true)}
                onUpdateDuration={handleUpdateDuration}
              />
            </div>
          ) : (
            <CollectionsView
              collections={userCollections}
              onOpenCreateModal={() => {
                setEditingCollection(null);
                setIsCreateCollectionOpen(true);
              }}
              onRefreshCollections={loadUserCollections}
              onEditCollection={(col) => {
                setEditingCollection(col);
                setIsCreateCollectionOpen(true);
              }}
              onOpenAddContent={(colId?: string) => {
                setAddModalInitialType(undefined);
                setAddModalInitialDate(undefined);
                setAddModalInitialCollectionId(colId);
                setIsAddModalOpen(true);
              }}
              onNavigateToInbox={() => setIsInboxOpen(true)}
              onNavigateToHome={() => handleTabChange('home')}
            />
          )}
        </main>

        {/* Unified Visual Inbox Drawer (Responsive: docked on desktop, slide-out on mobile/narrow) */}
        {isInboxOpen && (
          <InboxDrawer
            isOpen={isInboxOpen}
            onClose={() => setIsInboxOpen(false)}
            items={items}
            inboxItems={inboxItems}
            onSelectCard={setSelectedItem}
            onToggleComplete={handleToggleComplete}
            onTogglePriority={handleTogglePriority}
            onScheduleDate={handleMoveItemToDate}
            onOpenAddModal={() => {
              setAddModalInitialDate(undefined);
              setAddModalInitialCollectionId(undefined);
              setIsAddModalOpen(true);
            }}
            onMoveToInbox={handleMoveToInbox}
            onLoadStarterPack={handleLoadStarterPack}
            hasItems={items.length > 0}
            onOpenQuickPlan={handleOpenQuickPlan}
            onUpdateDuration={handleUpdateDuration}
            selectedItemIds={selectedItemIds}
            onToggleSelectItem={handleToggleSelectItem}
          />
        )}
      </div>

      {/* Cosmos-Style Curate Modal */}
      <AddContentModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setAddModalInitialCollectionId(undefined);
        }}
        onAdd={handleAddItem}
        availableTopics={availableTopics}
        onAddCustomTopic={handleAddCustomTopic}
        initialDate={addModalInitialDate}
        initialType={addModalInitialType}
        existingItems={items}
        collections={userCollections}
        initialCollectionId={addModalInitialCollectionId}
      />

      {/* Video Embed & Reflection Modal */}
      <ContentDetailModal
        item={selectedItem}
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        onUpdate={handleUpdateItem}
        onDelete={handleDeleteItem}
        onUpdateDuration={handleUpdateDuration}
        collections={userCollections}
        onAddToCollection={handleAddItemToCollection}
        onCreateCollectionWithItem={(item) => {
          setSelectedItemIds(new Set([item.id]));
          setEditingCollection(null);
          setIsCreateCollectionOpen(true);
        }}
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        items={items}
        onSelectItem={setSelectedItem}
      />

      {/* Day Inspector Drawer for dense days */}
      <DayDrawer
        dateStr={dayDrawerDate}
        isOpen={!!dayDrawerDate}
        onClose={() => setDayDrawerDate(null)}
        items={items}
        onSelectCard={setSelectedItem}
        onToggleComplete={handleToggleComplete}
        onTogglePriority={handleTogglePriority}
        onAddForDate={handleAddForDate}
        onUpdateDuration={handleUpdateDuration}
      />

      {/* Settings & Storage Backup Modal */}
      <SettingsBackupModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onLoadStarterPack={handleLoadStarterPack}
        onClearAll={() => {
          clearStoredItems();
          setItems([]);
        }}
        onDataReloaded={() => {
          setItems(getStoredItems());
        }}
        totalItems={items.length}
      />

      {/* Storage Full / Save Failure Safe Mode Alert Banner */}
      {storageFailure && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-2xl px-2 animate-in slide-in-from-top-4 duration-200"
        >
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 shadow-2xl border border-stone-800 dark:border-stone-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle className="w-5 h-5 text-amber-400 dark:text-amber-600 shrink-0" />
              <div className="text-xs font-sans">
                <span className="font-semibold block truncate">
                  Saving to browser storage failed
                </span>
                <span className="text-stone-300 dark:text-stone-600 text-[11px] line-clamp-1">
                  Data is safely kept in memory for this session. Export a backup now to prevent data loss.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-sans font-semibold bg-amber-500 hover:bg-amber-400 text-stone-950 transition-colors cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export backup</span>
              </button>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="px-2.5 py-1.5 rounded-full text-xs font-sans text-stone-300 hover:text-white dark:text-stone-600 dark:hover:text-stone-950 transition-colors cursor-pointer"
              >
                Settings
              </button>
              <button
                type="button"
                onClick={() => setStorageFailure(null)}
                className="p-1 text-stone-400 hover:text-white dark:hover:text-black transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Plan Undo Floating Banner */}
      {quickPlanUndoState && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 px-4 py-3 rounded-2xl shadow-2xl border border-stone-800 dark:border-stone-200 animate-in slide-in-from-bottom-5 duration-200">
          <span className="text-xs font-sans font-medium">
            {quickPlanUndoState.message}
          </span>
          <button
            type="button"
            onClick={handleUndoQuickPlan}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-sans font-semibold bg-white text-black dark:bg-black dark:text-white hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Undo</span>
          </button>
          <button
            type="button"
            onClick={() => setQuickPlanUndoState(null)}
            className="p-1 text-stone-400 hover:text-white dark:hover:text-black transition-colors cursor-pointer"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Quick Plan Modal (Unified for Plan 2h button and Calendar header) */}
      <QuickPlanModal
        isOpen={isQuickPlanOpen}
        onClose={() => setIsQuickPlanOpen(false)}
        onApply={(assignments) => {
          handleApplyQuickPlan(assignments);
          setIsQuickPlanOpen(false);
        }}
        weekDays={weekDaySlots}
        inboxItems={inboxItems}
        existingWeekItems={existingWeekItems}
        availableBudgetMinutes={quickPlanBudgetMinutes}
        dayThemes={dayThemes}
        onNavigateNextWeek={() => {
          setCurrentDate((prev) => {
            const next = new Date(prev);
            next.setDate(next.getDate() + 7);
            return next;
          });
          setActiveTab('calendar');
          setView('week');
        }}
        onUpdateDuration={handleUpdateDuration}
      />

      {/* Share My Week Modal */}
      <ShareWeekModal
        isOpen={isShareWeekOpen}
        onClose={() => setIsShareWeekOpen(false)}
        currentDate={currentDate}
        items={items}
        userId={currentUser?.id}
        onDateChange={setCurrentDate}
      />
      {/* Weekly Review Modal (Start-of-week factual totals & triage) */}
      <WeeklyReviewModal
        isOpen={isWeeklyReviewOpen}
        onClose={() => setIsWeeklyReviewOpen(false)}
        items={items}
        currentDate={currentDate}
        onUpdateItem={handleUpdateItem}
        onDeleteItem={handleDeleteItem}
        onPlanNextWeek={handlePlanNextWeekFromReview}
      />

      {/* Auth Modal (Google & Email magic link) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onOpenPrivacy={() => setIsPrivacyModalOpen(true)}
        onOpenTerms={() => setIsTermsModalOpen(true)}
      />

      {/* Account Menu Modal */}
      {currentUser && (
        <AccountMenuModal
          isOpen={isAccountMenuOpen}
          onClose={() => setIsAccountMenuOpen(false)}
          user={currentUser}
          items={items}
          onSignedOut={() => {
            setCurrentUser(null);
            setIsAccountMenuOpen(false);
          }}
          onAccountDeleted={() => {
            setCurrentUser(null);
            setIsAccountMenuOpen(false);
            clearStoredItems();
            setItems([]);
          }}
        />
      )}

      {/* First Sign-in Migration Modal */}
      <FirstSignInMigrationModal
        isOpen={isMigrationModalOpen}
        onClose={() => setIsMigrationModalOpen(false)}
        guestItems={items}
        guestSettings={getDataStore().loadSettingsSync ? getDataStore().loadSettingsSync!() : { customTopics: availableTopics, dayThemes, weekBudgets: {}, dayPreferencesEnabled: true }}
        onMigrationComplete={(migratedCount) => {
          if (currentUser) {
            localStorage.setItem('curate_migrated_' + currentUser.id, 'true');
          }
          setIsMigrationModalOpen(false);
        }}
        onSkipMigration={() => {
          if (currentUser) {
            localStorage.setItem('curate_migrated_' + currentUser.id, 'true');
          }
          setIsMigrationModalOpen(false);
        }}
      />

      {/* Multi-Device Sync Conflict Resolution Modal */}
      <SyncConflictModal
        isOpen={syncConflicts.length > 0}
        onClose={() => setSyncConflicts([])}
        conflicts={syncConflicts}
      />

      {/* Privacy Policy Modal */}
      <PrivacyPolicyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />

      {/* Terms of Service Modal */}
      <TermsOfServiceModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
      />

      {/* Floating Multi-Select Toolbar */}
      <MultiSelectToolbar
        selectedCount={selectedItemIds.size}
        onClearSelection={handleClearSelection}
        onCreateCollection={() => setIsCreateCollectionOpen(true)}
        collections={userCollections}
        onAddSelectedToCollection={handleAddSelectedToCollection}
      />

      {/* Create / Edit Public Collection Modal */}
      <CreateCollectionModal
        isOpen={isCreateCollectionOpen}
        onClose={() => {
          setIsCreateCollectionOpen(false);
          setEditingCollection(null);
          handleClearSelection();
        }}
        selectedItems={items.filter((it) => selectedItemIds.has(it.id))}
        allItems={items}
        userCollectionsCount={userCollections.filter((c) => c.isActive).length}
        userId={currentUser?.id}
        displayName={currentUser?.email ? currentUser.email.split('@')[0] : undefined}
        editingCollection={editingCollection}
        onCollectionCreated={(col) => {
          loadUserCollections();
          handleClearSelection();
        }}
        onCollectionUpdated={(col) => {
          loadUserCollections();
          handleClearSelection();
        }}
        onAddNewLibraryItem={(itemData) => {
          const newItem: ContentItem = {
            ...itemData,
            id: 'item-' + Date.now().toString(16),
            createdAt: new Date().toISOString(),
          };
          const updated = [newItem, ...items];
          setItems(updated);
          saveStoredItems(updated);
          return newItem;
        }}
      />

      {/* Toast Notification Banner */}
      {collectionToastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-stone-900 text-white dark:bg-white dark:text-stone-900 shadow-xl border border-stone-800 dark:border-stone-200 text-xs font-medium animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Check className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          <span>{collectionToastMessage}</span>
          <button
            onClick={() => setCollectionToastMessage(null)}
            className="ml-2 text-stone-400 hover:text-white dark:hover:text-stone-900 p-0.5"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* First-visit Privacy & Analytics Notice Banner */}
      <AnalyticsNoticeBanner />
    </div>
  );
}
