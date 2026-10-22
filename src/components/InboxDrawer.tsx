import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  Plus,
  SidebarClose,
  Star,
  ChevronDown,
  RotateCcw,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { ContentItem } from '../types';
import { ContentCard } from './ContentCard';
import { getTodayStr, getTomorrowStr } from '../lib/dateUtils';
import { formatHoursMinutes, getEstimatedDuration } from '../lib/timeAccounting';

type InboxStatusFilter = 'unscheduled' | 'scheduled' | 'completed' | 'all';
export type InboxTypeFilter = 'all' | 'video' | 'article' | 'podcast' | 'book';
export type InboxDurationFilter = 'all' | '<15m' | '15-30m' | '30-60m' | '1h+';
export type InboxSortOption = 'newest' | 'oldest' | 'shortest' | 'longest' | 'priority';

export const SPECIFIED_INBOX_TOPICS = [
  'Marketing',
  'UX/UI',
  'German',
  'English',
  'Health',
  'Fitness',
] as const;

interface InboxDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items?: ContentItem[]; // Complete collection pool for status filtering
  inboxItems?: ContentItem[]; // Backwards compatibility for unscheduled items
  onSelectCard: (item: ContentItem) => void;
  onToggleComplete: (id: string, e: React.MouseEvent) => void;
  onTogglePriority?: (id: string, e: React.MouseEvent) => void;
  onScheduleDate: (itemId: string, dateStr: string) => void;
  onOpenAddModal: () => void;
  onMoveToInbox: (itemId: string) => void;
  onLoadStarterPack?: () => void;
  hasItems?: boolean;
  isDocked?: boolean;
  onOpenQuickPlan?: (presetMinutes?: number) => void;
  onUpdateDuration?: (id: string, durationMinutes: number) => void;
  selectedItemIds?: Set<string>;
  onToggleSelectItem?: (id: string) => void;
}

export const InboxDrawer: React.FC<InboxDrawerProps> = ({
  isOpen,
  onClose,
  items,
  inboxItems = [],
  onSelectCard,
  onToggleComplete,
  onTogglePriority,
  onUpdateDuration,
  onScheduleDate,
  onOpenAddModal,
  onMoveToInbox,
  onLoadStarterPack,
  hasItems,
  isDocked = false,
  onOpenQuickPlan,
  selectedItemIds,
  onToggleSelectItem,
}) => {
  // Use all items pool if provided, else fallback to inboxItems
  const allItems = useMemo(() => {
    if (items && items.length > 0) return items;
    return inboxItems;
  }, [items, inboxItems]);

  // Filters & Sorting state
  const [statusFilter, setStatusFilter] = useState<InboxStatusFilter>('unscheduled');
  const [selectedType, setSelectedType] = useState<InboxTypeFilter>('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [selectedDuration, setSelectedDuration] = useState<InboxDurationFilter>('all');
  const [priorityOnly, setPriorityOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<InboxSortOption>('newest');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [dragOverInbox, setDragOverInbox] = useState(false);

  if (!isOpen) return null;

  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();

  // Summary Metrics: Total unplanned items and duration
  const unplannedItems = useMemo(() => {
    return allItems.filter(
      (it) => it.status === 'inbox' || (!it.scheduledDate && it.status !== 'completed')
    );
  }, [allItems]);

  const unplannedCount = unplannedItems.length;
  const unplannedTotalMinutes = useMemo(() => {
    return unplannedItems.reduce(
      (sum, it) => sum + (it.durationMinutes || getEstimatedDuration(it)),
      0
    );
  }, [unplannedItems]);

  const priorityCount = useMemo(() => {
    return allItems.filter((it) => it.isPriority).length;
  }, [allItems]);

  // Status-filtered pool for computing type badge counts
  const poolForCounts = useMemo(() => {
    return allItems.filter((it) => {
      if (statusFilter === 'unscheduled') {
        return it.status === 'inbox' || (!it.scheduledDate && it.status !== 'completed');
      }
      if (statusFilter === 'scheduled') {
        return (
          it.status === 'planned' ||
          it.status === 'in_progress' ||
          (Boolean(it.scheduledDate) && it.status !== 'completed')
        );
      }
      if (statusFilter === 'completed') {
        return it.status === 'completed';
      }
      return true; // 'all'
    });
  }, [allItems, statusFilter]);

  // Type Counts based on current status
  const typeCounts = useMemo(() => {
    return {
      all: poolForCounts.length,
      video: poolForCounts.filter(
        (it) => it.contentType === 'youtube' || it.contentType === 'documentary' || it.contentType === 'course'
      ).length,
      article: poolForCounts.filter((it) => it.contentType === 'article').length,
      podcast: poolForCounts.filter((it) => it.contentType === 'podcast').length,
      book: poolForCounts.filter((it) => it.contentType === 'book').length,
    };
  }, [poolForCounts]);

  // Multi-dimensional filtering logic
  const filteredAndSortedItems = useMemo(() => {
    const filtered = allItems.filter((it) => {
      // 1. Status Filter
      if (statusFilter === 'unscheduled') {
        const isUnscheduled = it.status === 'inbox' || (!it.scheduledDate && it.status !== 'completed');
        if (!isUnscheduled) return false;
      } else if (statusFilter === 'scheduled') {
        const isScheduled =
          it.status === 'planned' ||
          it.status === 'in_progress' ||
          (Boolean(it.scheduledDate) && it.status !== 'completed');
        if (!isScheduled) return false;
      } else if (statusFilter === 'completed') {
        if (it.status !== 'completed') return false;
      }

      // 2. Priority Only Filter
      if (priorityOnly && !it.isPriority) {
        return false;
      }

      // 3. Content Type Filter
      if (selectedType === 'video') {
        if (it.contentType !== 'youtube' && it.contentType !== 'documentary' && it.contentType !== 'course') {
          return false;
        }
      } else if (selectedType === 'article' && it.contentType !== 'article') {
        return false;
      } else if (selectedType === 'podcast' && it.contentType !== 'podcast') {
        return false;
      } else if (selectedType === 'book' && it.contentType !== 'book') {
        return false;
      }

      // 4. Topic Filter (Marketing, UX/UI, German, English, Health, Fitness, or other)
      if (selectedTopic !== 'all') {
        const itTopic = (it.topic || '').trim().toLowerCase();
        if (selectedTopic === 'other') {
          const isKnown = SPECIFIED_INBOX_TOPICS.some((t) => t.toLowerCase() === itTopic);
          if (isKnown) return false;
        } else {
          if (itTopic !== selectedTopic.toLowerCase()) return false;
        }
      }

      // 5. Duration Filter (<15m, 15-30m, 30-60m, 1h+)
      if (selectedDuration !== 'all') {
        const dur = it.durationMinutes || getEstimatedDuration(it);
        if (selectedDuration === '<15m' && dur >= 15) return false;
        if (selectedDuration === '15-30m' && (dur < 15 || dur > 30)) return false;
        if (selectedDuration === '30-60m' && (dur < 31 || dur > 60)) return false;
        if (selectedDuration === '1h+' && dur <= 60) return false;
      }

      // 6. Search Query
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesText =
          it.title.toLowerCase().includes(q) ||
          (it.topic && it.topic.toLowerCase().includes(q)) ||
          (it.author && it.author.toLowerCase().includes(q)) ||
          (it.notes && it.notes.toLowerCase().includes(q));
        if (!matchesText) return false;
      }

      return true;
    });

    // Sorting: Newest, Oldest, Shortest, Longest, Priority
    return filtered.sort((a, b) => {
      if (sortBy === 'priority') {
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }
      if (sortBy === 'newest') {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }
      if (sortBy === 'oldest') {
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      }
      if (sortBy === 'shortest') {
        const durA = a.durationMinutes || getEstimatedDuration(a);
        const durB = b.durationMinutes || getEstimatedDuration(b);
        return durA - durB;
      }
      if (sortBy === 'longest') {
        const durA = a.durationMinutes || getEstimatedDuration(a);
        const durB = b.durationMinutes || getEstimatedDuration(b);
        return durB - durA;
      }
      return 0;
    });
  }, [allItems, statusFilter, priorityOnly, selectedType, selectedTopic, selectedDuration, search, sortBy]);

  const hasActiveFilters =
    statusFilter !== 'unscheduled' ||
    selectedType !== 'all' ||
    selectedTopic !== 'all' ||
    selectedDuration !== 'all' ||
    priorityOnly ||
    search.trim().length > 0;

  const handleResetFilters = () => {
    setStatusFilter('unscheduled');
    setSelectedType('all');
    setSelectedTopic('all');
    setSelectedDuration('all');
    setPriorityOnly(false);
    setSearch('');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverInbox(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverInbox(false);
    const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.id) {
          onMoveToInbox(parsed.id);
          return;
        }
      } catch {
        onMoveToInbox(raw);
      }
    }
  };

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-full max-w-sm lg:max-w-none lg:relative lg:inset-auto lg:z-10 lg:w-88 xl:w-96 shrink-0 border-l border-stone-200/50 dark:border-stone-850 bg-[#FAF9F6] dark:bg-[#0C0C0C] shadow-2xl lg:shadow-none flex flex-col h-full lg:h-[calc(100vh-61px)] lg:sticky lg:top-[61px] overflow-x-hidden transition-all"
    >
      {/* Top Header & Summary */}
      <div className="p-3.5 sm:p-4 border-b border-stone-200/40 dark:border-stone-900 bg-white/40 dark:bg-stone-950/40">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <span className="font-serif text-lg font-normal text-stone-900 dark:text-stone-100">
              inbox
            </span>
            <span className="text-[11px] font-mono tabular-nums text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-900 px-2 py-0.5 rounded-full border border-stone-200/50 dark:border-stone-800">
              {unplannedCount} unplanned / {formatHoursMinutes(unplannedTotalMinutes)} total
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowSearch(!showSearch)}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                showSearch || search
                  ? 'text-stone-900 dark:text-stone-100 bg-stone-200/60 dark:bg-stone-800'
                  : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
              }`}
              title="Search inbox"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer p-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-900"
              title="Close inbox"
            >
              <SidebarClose className="hidden lg:block w-4 h-4" />
              <X className="lg:hidden w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action bar: Plan 2h button and Curate action */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenQuickPlan?.(120)}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-black dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 text-xs font-medium shadow-xs transition-transform active:scale-[0.98] cursor-pointer"
            title="Open Quick Plan proposal preset to 2 hours"
          >
            <span>Plan 2h</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-800 text-xs font-sans text-stone-600 dark:text-stone-300 hover:text-black dark:hover:text-white bg-white/70 dark:bg-stone-900/60 transition-colors cursor-pointer shrink-0"
            title="Curate new item"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>

        {/* Optional Collapsible Search Input */}
        {showSearch && (
          <div className="mt-2.5 relative animate-in fade-in slide-in-from-top-1 duration-150">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, topic, author..."
              className="w-full text-xs font-sans pl-8 pr-7 py-1.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 2 to 3 Lines of Filters (NO HORIZONTAL SCROLL) */}
      <div className="px-3.5 py-2.5 border-b border-stone-200/40 dark:border-stone-900 bg-stone-50/50 dark:bg-[#111111]/40 space-y-2">
        {/* Line 1: Status Filter Tabs (Unscheduled, Scheduled, Completed, All) + Priority Toggle */}
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="inline-flex items-center p-0.5 rounded-lg bg-stone-200/50 dark:bg-stone-900 text-xs font-sans">
            {(['unscheduled', 'scheduled', 'completed', 'all'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-1 rounded-md text-[11px] capitalize transition-colors cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 font-medium shadow-2xs'
                    : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                {st === 'unscheduled' ? 'Unscheduled' : st === 'scheduled' ? 'Scheduled' : st === 'completed' ? 'Completed' : 'All'}
              </button>
            ))}
          </div>

          {/* Single Simple Priority Toggle */}
          <button
            type="button"
            onClick={() => setPriorityOnly(!priorityOnly)}
            title={priorityOnly ? 'Showing priority only (click to show all)' : 'Show priority items only'}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-sans border transition-all cursor-pointer ${
              priorityOnly
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 font-medium'
                : 'border-stone-200 dark:border-stone-800 text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 bg-white/60 dark:bg-stone-900/40'
            }`}
          >
            <Star className={`w-3 h-3 ${priorityOnly ? 'fill-current text-amber-500' : 'text-stone-400'}`} />
            <span>Priority</span>
            {priorityCount > 0 && <span className="opacity-70 font-mono text-[10px]">({priorityCount})</span>}
          </button>
        </div>

        {/* Line 2: Content Type Chips (All, Videos, Articles, Podcasts, Books) */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs font-sans">
          {[
            { id: 'all', label: 'All', count: typeCounts.all },
            { id: 'video', label: 'Videos', count: typeCounts.video },
            { id: 'article', label: 'Articles', count: typeCounts.article },
            { id: 'podcast', label: 'Podcasts', count: typeCounts.podcast },
            { id: 'book', label: 'Books', count: typeCounts.book },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedType(cat.id as any)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1 ${
                selectedType === cat.id
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 font-medium shadow-2xs'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 bg-stone-200/50 dark:bg-stone-900/60'
              }`}
            >
              <span>{cat.label}</span>
              <span className="text-[10px] opacity-60">({cat.count})</span>
            </button>
          ))}
        </div>

        {/* Line 3: Dropdowns for Topic, Duration, and Sorting */}
        <div className="grid grid-cols-3 gap-1.5 text-xs font-sans pt-0.5">
          {/* Topic Dropdown */}
          <div className="relative">
            <select
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              aria-label="Filter by topic"
              className="w-full appearance-none pl-2 pr-5 py-1 rounded-md border border-stone-200 dark:border-stone-850 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 text-[11px] truncate cursor-pointer focus:outline-none focus:ring-1 focus:ring-stone-400"
            >
              <option value="all">All Topics</option>
              <option value="Marketing">Marketing</option>
              <option value="UX/UI">UX/UI</option>
              <option value="German">German</option>
              <option value="English">English</option>
              <option value="Health">Health</option>
              <option value="Fitness">Fitness</option>
              <option value="other">Other / Remaining</option>
            </select>
            <ChevronDown className="w-3 h-3 text-stone-400 pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" />
          </div>

          {/* Duration Dropdown */}
          <div className="relative">
            <select
              value={selectedDuration}
              onChange={(e) => setSelectedDuration(e.target.value as any)}
              aria-label="Filter by duration"
              className="w-full appearance-none pl-2 pr-5 py-1 rounded-md border border-stone-200 dark:border-stone-850 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 text-[11px] truncate cursor-pointer focus:outline-none focus:ring-1 focus:ring-stone-400"
            >
              <option value="all">All Lengths</option>
              <option value="<15m">&lt; 15m</option>
              <option value="15-30m">15–30m</option>
              <option value="30-60m">30–60m</option>
              <option value="1h+">1h+</option>
            </select>
            <ChevronDown className="w-3 h-3 text-stone-400 pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" />
          </div>

          {/* Sort Dropdown */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              aria-label="Sort backlog"
              className="w-full appearance-none pl-2 pr-5 py-1 rounded-md border border-stone-200 dark:border-stone-850 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 text-[11px] truncate cursor-pointer focus:outline-none focus:ring-1 focus:ring-stone-400"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="shortest">Shortest</option>
              <option value="longest">Longest</option>
              <option value="priority">Priority</option>
            </select>
            <ChevronDown className="w-3 h-3 text-stone-400 pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        {/* Filter status & Reset pill */}
        {hasActiveFilters && (
          <div className="flex items-center justify-between text-[11px] text-stone-400 pt-0.5 px-0.5">
            <span>
              Showing {filteredAndSortedItems.length} of {allItems.length}
            </span>
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-stone-600 dark:text-stone-400 hover:text-black dark:hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Reset filters</span>
            </button>
          </div>
        )}
      </div>

      {/* Cards Stream (Vertical only, no horizontal scroll) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOverInbox(false)}
        onDrop={handleDrop}
        className={`flex-1 p-3.5 sm:p-4 overflow-y-auto overflow-x-hidden space-y-4 transition-colors ${
          dragOverInbox ? 'bg-stone-100/60 dark:bg-stone-900/40' : ''
        }`}
      >
        {filteredAndSortedItems.length === 0 ? (
          <div className="py-16 text-center px-4">
            <p className="font-serif italic text-stone-400 dark:text-stone-600 text-sm">
              {hasActiveFilters ? 'No items match your active filters.' : 'Your inbox is clear.'}
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-3 text-xs font-sans text-stone-600 dark:text-stone-400 hover:text-black dark:hover:text-white underline underline-offset-4 cursor-pointer"
              >
                Clear all filters
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenAddModal}
                className="mt-3 text-xs font-sans text-stone-600 dark:text-stone-400 hover:text-black dark:hover:text-white underline underline-offset-4 cursor-pointer"
              >
                + Curate something
              </button>
            )}
          </div>
        ) : (
          filteredAndSortedItems.map((item) => (
            <div key={item.id} className="space-y-1.5">
              <ContentCard
                item={item}
                onSelect={onSelectCard}
                onToggleComplete={onToggleComplete}
                onTogglePriority={onTogglePriority}
                onUpdateDuration={onUpdateDuration}
                isSelected={selectedItemIds?.has(item.id)}
                onToggleSelect={onToggleSelectItem}
              />

              {/* Quiet Quick Schedule & Action bar */}
              <div className="flex items-center justify-between text-[10px] font-sans text-stone-400 px-0.5">
                <span className="flex items-center gap-1">
                  <span>Quick move:</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onScheduleDate(item.id, todayStr)}
                    className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
                    title={`Schedule for today (${todayStr})`}
                  >
                    Today
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => onScheduleDate(item.id, tomorrowStr)}
                    className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
                    title={`Schedule for tomorrow (${tomorrowStr})`}
                  >
                    Tomorrow
                  </button>
                  {item.scheduledDate && (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => onMoveToInbox(item.id)}
                        className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer"
                        title="Unschedule back to inbox"
                      >
                        Unschedule
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Subtle Drag Target Prompt */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOverInbox(false)}
        onDrop={handleDrop}
        className="p-3 border-t border-stone-200/40 dark:border-stone-900 text-center text-[11px] text-stone-400 font-sans shrink-0 bg-stone-50/30 dark:bg-stone-950/20"
      >
        <span>Drop cards here to unschedule to inbox</span>
      </div>
    </aside>
  );
};
