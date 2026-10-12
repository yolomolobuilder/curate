import React, { useState, useMemo } from 'react';
import {
  X,
  CheckCircle2,
  Calendar,
  Clock,
  ArrowRight,
  Inbox,
  CalendarPlus,
  Trash2,
  Star,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Sparkles,
  HelpCircle,
  BookmarkCheck,
} from 'lucide-react';
import { ContentItem } from '../types';
import { formatHoursMinutes, formatDuration, getEstimatedDuration } from '../lib/timeAccounting';
import { getWeekDates, toDateStr } from '../lib/dateUtils';
import {
  getWeeklyReviewData,
  keepItemInBacklog,
  rescheduleItemToDate,
  WeeklyReviewData,
} from '../lib/weeklyReview';

interface WeeklyReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: ContentItem[];
  currentDate: Date; // current week anchor
  onUpdateItem: (id: string, updates: Partial<ContentItem>) => void;
  onDeleteItem: (id: string) => void;
  onPlanNextWeek: () => void;
}

export const WeeklyReviewModal: React.FC<WeeklyReviewModalProps> = ({
  isOpen,
  onClose,
  items,
  currentDate,
  onUpdateItem,
  onDeleteItem,
  onPlanNextWeek,
}) => {
  // Local interest categorization overrides: itemId -> 'still_interested' | 'didnt_get_to'
  const [interestOverrides, setInterestOverrides] = useState<
    Record<string, 'still_interested' | 'didnt_get_to'>
  >({});

  // Active section tab: 'all' | 'unfinished' | 'completed'
  const [activeTab, setActiveTab] = useState<'all' | 'unfinished' | 'completed'>('all');

  // Currently open reschedule popover for itemId
  const [reschedulePopoverId, setReschedulePopoverId] = useState<string | null>(null);

  // New week days for reschedule target
  const newWeekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  // Review data for previous week
  const reviewData: WeeklyReviewData = useMemo(() => {
    return getWeeklyReviewData(items, currentDate, interestOverrides);
  }, [items, currentDate, interestOverrides]);

  if (!isOpen) return null;

  const { range, totals, completedItems, stillInterestedItems, didntGetToItems } = reviewData;

  const handleToggleInterest = (itemId: string, currentCategory: 'still_interested' | 'didnt_get_to') => {
    setInterestOverrides((prev) => ({
      ...prev,
      [itemId]: currentCategory === 'still_interested' ? 'didnt_get_to' : 'still_interested',
    }));
  };

  const handleKeep = (item: ContentItem) => {
    const updated = keepItemInBacklog(item);
    onUpdateItem(item.id, updated);
    setReschedulePopoverId(null);
  };

  const handleReschedule = (item: ContentItem, targetDateStr: string) => {
    const updated = rescheduleItemToDate(item, targetDateStr);
    onUpdateItem(item.id, updated);
    setReschedulePopoverId(null);
  };

  const handleRemove = (itemId: string) => {
    onDeleteItem(itemId);
    setReschedulePopoverId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-stone-900/60 dark:bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-white dark:bg-[#141414] rounded-3xl border border-stone-200 dark:border-stone-850 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 sm:px-8 pt-6 pb-4 border-b border-stone-100 dark:border-stone-850">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Start of Week
              </span>
              <span className="text-stone-300 dark:text-stone-700">·</span>
              <span className="text-xs font-sans text-stone-500 dark:text-stone-400">
                {range.label}
              </span>
            </div>
            <h2 className="font-serif text-2xl font-normal text-stone-900 dark:text-stone-100 mt-0.5">
              Weekly Review
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-full hover:bg-stone-100 dark:hover:bg-stone-850 transition-colors cursor-pointer"
            aria-label="Close Weekly Review"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-6">
          {/* Previous-Week Totals HUD */}
          <div className="bg-stone-50/80 dark:bg-stone-900/50 rounded-2xl p-5 border border-stone-200/80 dark:border-stone-850">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Previous-Week Totals
              </span>
              <span className="text-xs font-mono text-stone-500 dark:text-stone-400 tabular-nums">
                {totals.completionRate}% completed
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-4">
              {/* Planned */}
              <div className="bg-white dark:bg-[#181818] p-3.5 rounded-xl border border-stone-200/60 dark:border-stone-800">
                <span className="text-[11px] font-sans text-stone-400 dark:text-stone-500">
                  Planned
                </span>
                <p className="font-serif text-xl sm:text-2xl font-medium text-stone-900 dark:text-stone-100 tabular-nums mt-0.5">
                  {formatHoursMinutes(totals.plannedMinutes)}
                </p>
                <span className="text-[11px] font-mono text-stone-400 dark:text-stone-500 mt-1 block">
                  {totals.totalItemsCount} {totals.totalItemsCount === 1 ? 'item' : 'items'}
                </span>
              </div>

              {/* Completed */}
              <div className="bg-white dark:bg-[#181818] p-3.5 rounded-xl border border-stone-200/60 dark:border-stone-800">
                <span className="text-[11px] font-sans text-stone-400 dark:text-stone-500">
                  Completed
                </span>
                <p className="font-serif text-xl sm:text-2xl font-medium text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                  {formatHoursMinutes(totals.completedMinutes)}
                </p>
                <span className="text-[11px] font-mono text-stone-400 dark:text-stone-500 mt-1 block">
                  {totals.completedCount} completed
                </span>
              </div>

              {/* Unfinished */}
              <div className="bg-white dark:bg-[#181818] p-3.5 rounded-xl border border-stone-200/60 dark:border-stone-800">
                <span className="text-[11px] font-sans text-stone-400 dark:text-stone-500">
                  Unfinished
                </span>
                <p className="font-serif text-xl sm:text-2xl font-medium text-amber-600 dark:text-amber-400 tabular-nums mt-0.5">
                  {formatHoursMinutes(totals.unfinishedMinutes)}
                </p>
                <span className="text-[11px] font-mono text-stone-400 dark:text-stone-500 mt-1 block">
                  {totals.unfinishedCount} unfinished
                </span>
              </div>
            </div>

            {/* Completion Bar */}
            <div className="w-full h-2 rounded-full bg-stone-200 dark:bg-stone-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${totals.completionRate}%` }}
              />
            </div>
          </div>

          {/* Section Filter Tabs */}
          <div className="flex items-center gap-1.5 border-b border-stone-200/70 dark:border-stone-850 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              All Items ({totals.totalItemsCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unfinished')}
              className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer ${
                activeTab === 'unfinished'
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Unfinished ({totals.unfinishedCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className={`px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-colors cursor-pointer ${
                activeTab === 'completed'
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-stone-500 hover:text-stone-900 dark:hover:text-stone-200'
              }`}
            >
              Completed ({totals.completedCount})
            </button>
          </div>

          {/* 1. STILL INTERESTED SECTION */}
          {(activeTab === 'all' || activeTab === 'unfinished') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <h3 className="font-serif text-base font-normal text-stone-900 dark:text-stone-100">
                    Still interested
                  </h3>
                  <span className="text-xs font-mono text-stone-400 tabular-nums">
                    ({stillInterestedItems.length})
                  </span>
                </div>
                <span className="text-[11px] font-sans text-stone-400">
                  Keep in backlog, reschedule, or remove
                </span>
              </div>

              {stillInterestedItems.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-stone-200 dark:border-stone-850 text-xs font-sans text-stone-400 text-center">
                  No items categorized under Still interested
                </div>
              ) : (
                <div className="space-y-2">
                  {stillInterestedItems.map((item) => (
                    <UnfinishedItemRow
                      key={item.id}
                      item={item}
                      category="still_interested"
                      onToggleCategory={() => handleToggleInterest(item.id, 'still_interested')}
                      onKeep={() => handleKeep(item)}
                      onReschedule={(targetDate) => handleReschedule(item, targetDate)}
                      onRemove={() => handleRemove(item.id)}
                      isPopoverOpen={reschedulePopoverId === item.id}
                      onTogglePopover={() =>
                        setReschedulePopoverId(reschedulePopoverId === item.id ? null : item.id)
                      }
                      newWeekDates={newWeekDates}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 2. DIDN'T GET TO SECTION */}
          {(activeTab === 'all' || activeTab === 'unfinished') && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-stone-400" />
                  <h3 className="font-serif text-base font-normal text-stone-900 dark:text-stone-100">
                    Didn't get to
                  </h3>
                  <span className="text-xs font-mono text-stone-400 tabular-nums">
                    ({didntGetToItems.length})
                  </span>
                </div>
                <span className="text-[11px] font-sans text-stone-400">
                  Unfinished items to triage
                </span>
              </div>

              {didntGetToItems.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-stone-200 dark:border-stone-850 text-xs font-sans text-stone-400 text-center">
                  No items categorized under Didn't get to
                </div>
              ) : (
                <div className="space-y-2">
                  {didntGetToItems.map((item) => (
                    <UnfinishedItemRow
                      key={item.id}
                      item={item}
                      category="didnt_get_to"
                      onToggleCategory={() => handleToggleInterest(item.id, 'didnt_get_to')}
                      onKeep={() => handleKeep(item)}
                      onReschedule={(targetDate) => handleReschedule(item, targetDate)}
                      onRemove={() => handleRemove(item.id)}
                      isPopoverOpen={reschedulePopoverId === item.id}
                      onTogglePopover={() =>
                        setReschedulePopoverId(reschedulePopoverId === item.id ? null : item.id)
                      }
                      newWeekDates={newWeekDates}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3. COMPLETED SECTION */}
          {(activeTab === 'all' || activeTab === 'completed') && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <h3 className="font-serif text-base font-normal text-stone-900 dark:text-stone-100">
                    Completed
                  </h3>
                  <span className="text-xs font-mono text-stone-400 tabular-nums">
                    ({completedItems.length})
                  </span>
                </div>
              </div>

              {completedItems.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-stone-200 dark:border-stone-850 text-xs font-sans text-stone-400 text-center">
                  No items marked as completed in the previous week
                </div>
              ) : (
                <div className="space-y-2">
                  {completedItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-stone-50/70 dark:bg-stone-900/40 border border-stone-200/50 dark:border-stone-850/60"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span data-clarity-mask="True" className="text-xs font-sans text-stone-800 dark:text-stone-200 truncate line-through opacity-75">
                          {item.title}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-400 capitalize shrink-0">
                          {item.contentType}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <span className="text-xs font-mono text-stone-400 tabular-nums">
                          {formatDuration(item.durationMinutes || getEstimatedDuration(item))}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer / Primary Action: Plan next week */}
        <div className="px-6 sm:px-8 py-4 border-t border-stone-200/70 dark:border-stone-850 bg-stone-50/50 dark:bg-[#181818] flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs font-sans text-stone-500 dark:text-stone-400">
            {totals.unfinishedCount > 0
              ? `${totals.unfinishedCount} unfinished item${totals.unfinishedCount === 1 ? '' : 's'} remaining from previous week`
              : 'All previous-week items accounted for'}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-full text-xs font-sans text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              Done Reviewing
            </button>
            <button
              type="button"
              onClick={onPlanNextWeek}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-xs font-sans font-medium text-white bg-black dark:bg-white dark:text-black hover:opacity-90 transition-all cursor-pointer shadow-sm group"
            >
              <span>Plan next week</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface UnfinishedItemRowProps {
  item: ContentItem;
  category: 'still_interested' | 'didnt_get_to';
  onToggleCategory: () => void;
  onKeep: () => void;
  onReschedule: (targetDateStr: string) => void;
  onRemove: () => void;
  isPopoverOpen: boolean;
  onTogglePopover: () => void;
  newWeekDates: Array<{ date: Date; dateStr: string }>;
}

const UnfinishedItemRow: React.FC<UnfinishedItemRowProps> = ({
  item,
  category,
  onToggleCategory,
  onKeep,
  onReschedule,
  onRemove,
  isPopoverOpen,
  onTogglePopover,
  newWeekDates,
}) => {
  return (
    <div className="p-3.5 rounded-xl bg-white dark:bg-[#191919] border border-stone-200/80 dark:border-stone-800 shadow-2xs space-y-2.5">
      {/* Title & Metadata */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 capitalize">
              {item.contentType}
            </span>
            {item.topic && (
              <span className="text-[10px] font-sans text-stone-500 dark:text-stone-400">
                {item.topic}
              </span>
            )}
            <span className="text-xs font-mono text-stone-400 tabular-nums">
              {formatDuration(item.durationMinutes || getEstimatedDuration(item))}
            </span>
          </div>
          <h4 data-clarity-mask="True" className="text-sm font-sans font-medium text-stone-900 dark:text-stone-100 line-clamp-1">
            {item.title}
          </h4>
        </div>

        {/* Category Switcher Pill */}
        <button
          type="button"
          onClick={onToggleCategory}
          title={
            category === 'still_interested'
              ? "Move to Didn't get to"
              : 'Move to Still interested'
          }
          className={`shrink-0 text-[11px] font-sans px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
            category === 'still_interested'
              ? 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20'
              : 'border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
          }`}
        >
          {category === 'still_interested' ? '★ Still interested' : "Didn't get to"}
        </button>
      </div>

      {/* Triage Actions: Keep / Reschedule / Remove */}
      <div className="flex items-center justify-between pt-2 border-t border-stone-100 dark:border-stone-850 text-xs">
        <span className="text-[11px] font-sans text-stone-400">Triage:</span>

        <div className="relative flex items-center gap-1.5">
          {/* Keep (Move to Backlog / Inbox) */}
          <button
            type="button"
            onClick={onKeep}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-850 hover:bg-stone-200/80 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            title="Keep in backlog (clear schedule date)"
          >
            <Inbox className="w-3 h-3" />
            <span>Keep</span>
          </button>

          {/* Reschedule (Dropdown to select day in new week) */}
          <div className="relative">
            <button
              type="button"
              onClick={onTogglePopover}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-850 hover:bg-stone-200/80 dark:hover:bg-stone-800 transition-colors cursor-pointer"
              title="Reschedule to next week"
            >
              <CalendarPlus className="w-3 h-3" />
              <span>Reschedule</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </button>

            {/* Reschedule Target Date Picker Popover */}
            {isPopoverOpen && (
              <div className="absolute right-0 bottom-full mb-1 z-30 w-48 bg-white dark:bg-[#202020] rounded-xl border border-stone-200 dark:border-stone-750 shadow-xl p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150">
                <div className="text-[10px] font-mono uppercase text-stone-400 dark:text-stone-500 px-2 py-1">
                  Reschedule to:
                </div>
                {newWeekDates.map((wd) => {
                  const dayName = wd.date.toLocaleDateString('en-US', { weekday: 'short' });
                  const dateNum = wd.date.getDate();
                  return (
                    <button
                      key={wd.dateStr}
                      type="button"
                      onClick={() => onReschedule(wd.dateStr)}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-sans text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer text-left"
                    >
                      <span>{dayName}</span>
                      <span className="text-[10px] font-mono text-stone-400">
                        {wd.dateStr.slice(5)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Remove */}
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
            title="Remove item"
          >
            <Trash2 className="w-3 h-3" />
            <span>Remove</span>
          </button>
        </div>
      </div>
    </div>
  );
};
