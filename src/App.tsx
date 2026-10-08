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
} from './lib/storage';
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
import { RotateCcw, X } from 'lucide-react';
import { calculateTimeForMonth, calculateTimeForDate } from './lib/timeAccounting';
import { toDateStr, getOffsetDateStr, getTodayStr, getWeekDates } from './lib/dateUtils';
import { QuickPlanModal } from './components/QuickPlanModal';

export default function App() {
  const [items, setItems] = useState<ContentItem[]>(() => getStoredItems());
  const [dayThemes] = useState<DayTheme[]>(() => getStoredDayThemes());
  const [availableTopics, setAvailableTopics] = useState<string[]>(() => getStoredCustomTopics());

  // Primary tab: 'home' (Cosmos discovery & visual library) vs 'calendar' (schedule)
  const [activeTab, setActiveTab] = useState<'home' | 'calendar'>(() => {
    // If user already has scheduled items, they can see calendar, but home is great first experience
    return 'home';
  });

  // Date navigation
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [view, setView] = useState<CalendarView>('month');

  // Dark mode
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('curatecal_dark_mode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Quick Plan Modal state & preset budget
  const [isQuickPlanOpen, setIsQuickPlanOpen] = useState(false);
  const [quickPlanBudgetMinutes, setQuickPlanBudgetMinutes] = useState<number>(120);

  const handleOpenQuickPlan = (presetMinutes?: number) => {
    setQuickPlanBudgetMinutes(presetMinutes ?? 120);
    setIsQuickPlanOpen(true);
  };

  // Quick Plan Undo state & timer
  const [quickPlanUndoState, setQuickPlanUndoState] = useState<{
    previousItems: ContentItem[];
    message: string;
  } | null>(null);

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
    saveStoredItems(newItems);
  };

  // Add Item
  const handleAddItem = (newItemData: Omit<ContentItem, 'id' | 'createdAt'>) => {
    const newItem: ContentItem = {
      ...newItemData,
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    const updated = [newItem, ...items];
    handleSaveItems(updated);

    // Activation milestone tracking: sample items never count toward activation
    const activeCount = updated.filter((i) => !i.isSample && i.status !== 'completed').length;
    if (!newItem.isSample) {
      recordActivationSave(activeCount, newItem.title, newItem.contentType, false);
      if (newItem.scheduledDate) {
        recordActivationScheduled(newItem.id, newItem.scheduledDate, newItem.title, false);
      }
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

    const activeCount = updated.filter((i) => !i.isSample && i.status !== 'completed').length;
    if (!newItem.isSample) {
      recordActivationSave(activeCount, newItem.title, newItem.contentType, false);
      recordActivationScheduled(newItem.id, targetDateStr, newItem.title, false);
    }
  };

  // Update Item
  const handleUpdateItem = (id: string, updates: Partial<ContentItem>) => {
    const target = items.find((it) => it.id === id);
    const updated = items.map((it) => (it.id === id ? { ...it, ...updates } : it));
    handleSaveItems(updated);
    if (updates.scheduledDate && (!target || !target.isSample)) {
      recordActivationScheduled(id, updates.scheduledDate, updates.title || target?.title, false);
    }
    if (selectedItem && selectedItem.id === id) {
      setSelectedItem((prev) => (prev ? { ...prev, ...updates } : null));
    }
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
  };

  // Move item to date
  const handleMoveItemToDate = (itemId: string, targetDateStr: string) => {
    const target = items.find((it) => it.id === itemId);
    if (!target) return;
    handleUpdateItem(itemId, {
      scheduledDate: targetDateStr,
      status: target.status === 'inbox' ? 'planned' : target.status,
    });
    recordActivationScheduled(itemId, targetDateStr, target.title);
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
    recordActivationCalendarViewed('plan_my_week');
  };

  // Tab change with activation calendar viewed tracking
  const handleTabChange = (tab: 'home' | 'calendar') => {
    setActiveTab(tab);
    if (tab === 'calendar') {
      recordActivationCalendarViewed('nav');
    }
  };

  // Add for date
  const handleAddForDate = (dateStr: string) => {
    setAddModalInitialDate(dateStr);
    setIsAddModalOpen(true);
  };

  // Custom Topic
  const handleAddCustomTopic = (newTopic: string) => {
    const updated = saveCustomTopic(newTopic);
    setAvailableTopics(updated);
  };

  // Load starter collection
  const handleLoadStarterPack = () => {
    const starters = generateCuratedStarterPack();
    handleSaveItems(starters);
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
      {/* Cosmos-Style Minimal Header */}
      <TopNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        currentDate={currentDate}
        view={view}
        onViewChange={setView}
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
            />
          ) : (
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
                onViewChange={setView}
                inboxItems={inboxItems}
                onApplyQuickPlan={handleApplyQuickPlan}
                onOpenQuickPlan={handleOpenQuickPlan}
              />
            </div>
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
              setIsAddModalOpen(true);
            }}
            onMoveToInbox={handleMoveToInbox}
            onLoadStarterPack={handleLoadStarterPack}
            hasItems={items.length > 0}
            onOpenQuickPlan={handleOpenQuickPlan}
          />
        )}
      </div>

      {/* Cosmos-Style Curate Modal */}
      <AddContentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddItem}
        availableTopics={availableTopics}
        onAddCustomTopic={handleAddCustomTopic}
        initialDate={addModalInitialDate}
        initialType={addModalInitialType}
        existingItems={items}
      />

      {/* Video Embed & Reflection Modal */}
      <ContentDetailModal
        item={selectedItem}
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        onUpdate={handleUpdateItem}
        onDelete={handleDeleteItem}
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
      />
    </div>
  );
}
