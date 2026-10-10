import React, { useState, useMemo, useEffect } from 'react';
import { Plus, ChevronRight, ChevronLeft, X, RotateCcw, Sparkles } from 'lucide-react';
import { ContentItem, CalendarView, DayTheme, BudgetPreset } from '../types';
import { ContentCard } from './ContentCard';
import { ContinuationMarker } from './ContinuationMarker';
import { TimeBudgetHeader } from './TimeBudgetHeader';
import { QuickPlanModal } from './QuickPlanModal';
import { getStoredWeekBudget, saveStoredWeekBudget } from '../lib/storage';
import { WeekDaySlot } from '../lib/quickPlanner';
import {
  calculateTimeForDate,
  calculateTimeForDateSet,
  formatHoursMinutes,
  getItemMultiDayInfo,
  getEstimatedDuration,
} from '../lib/timeAccounting';
import { toDateStr, getWeekDates } from '../lib/dateUtils';
import { getWeeklyReviewData } from '../lib/weeklyReview';
import { trackEvent } from '../lib/analytics';

interface CalendarGridProps {
  currentDate: Date;
  view: CalendarView;
  items: ContentItem[];
  dayThemes: DayTheme[];
  onSelectCard: (item: ContentItem) => void;
  onToggleComplete: (id: string, e: React.MouseEvent) => void;
  onTogglePriority?: (id: string, e: React.MouseEvent) => void;
  onMoveItemToDate: (itemId: string, targetDateStr: string, method?: 'drag' | 'quick_move' | 'quick_plan' | 'modal') => void;
  onAddNewItemToDate?: (item: any, targetDateStr: string) => void;
  onAddForDate: (dateStr: string) => void;
  onOpenDayDrawer: (dateStr: string) => void;
  onDateChange?: (date: Date) => void;
  onViewChange?: (view: CalendarView) => void;
  inboxItems?: ContentItem[];
  onApplyQuickPlan?: (assignments: { itemId: string; targetDateStr: string }[]) => void;
  onOpenQuickPlan?: (budgetMins?: number) => void;
  onOpenWeeklyReview?: () => void;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  currentDate,
  view,
  items,
  dayThemes,
  onSelectCard,
  onToggleComplete,
  onTogglePriority,
  onMoveItemToDate,
  onAddNewItemToDate,
  onAddForDate,
  onOpenDayDrawer,
  onDateChange,
  onViewChange,
  inboxItems = [],
  onApplyQuickPlan,
  onOpenQuickPlan,
  onOpenWeeklyReview,
}) => {
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [monthlyStyle, setMonthlyStyle] = useState<'visual' | 'text-only'>('visual');
  const [isQuickPlanOpen, setIsQuickPlanOpen] = useState(false);

  // Previous-week review data and dismissal state
  const prevWeekData = useMemo(
    () => getWeeklyReviewData(items, currentDate),
    [items, currentDate]
  );

  const [isBannerDismissed, setIsBannerDismissed] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem(`curatecal_dismissed_review_${prevWeekData.range.startStr}`) ===
        'true'
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const dismissed =
        localStorage.getItem(`curatecal_dismissed_review_${prevWeekData.range.startStr}`) ===
        'true';
      setIsBannerDismissed(dismissed);
    } catch {
      setIsBannerDismissed(false);
    }
  }, [prevWeekData.range.startStr]);

  const handleDismissBanner = () => {
    setIsBannerDismissed(true);
    try {
      localStorage.setItem(`curatecal_dismissed_review_${prevWeekData.range.startStr}`, 'true');
    } catch {}
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const todayStr = toDateStr(new Date());

  const navigateDay = (offset: number) => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + offset);
    onDateChange?.(next);
  };

  const navigateWeek = (offset: number) => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + offset * 7);
    onDateChange?.(next);
  };

  const jumpToToday = () => {
    onDateChange?.(new Date());
  };

  const getItemsForDate = (dateStr: string) => {
    return items.filter((item) => {
      if (item.scheduledDate === dateStr) return true;
      if (item.scheduledDate && item.scheduledEndDate) {
        return dateStr >= item.scheduledDate && dateStr <= item.scheduledEndDate;
      }
      return false;
    });
  };

  const dayOfWeekNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // --- MONTH VIEW LOGIC ---
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  const firstDayWeekday = firstDayOfMonth.getDay();
  const leadDays = firstDayWeekday === 0 ? 6 : firstDayWeekday - 1;

  const totalDaysInMonth = lastDayOfMonth.getDate();

  const calendarDays: Array<{ date: Date; dateStr: string; isCurrentMonth: boolean }> = [];

  for (let i = leadDays; i > 0; i--) {
    const d = new Date(year, month, 1 - i);
    calendarDays.push({ date: d, dateStr: toDateStr(d), isCurrentMonth: false });
  }

  for (let i = 1; i <= totalDaysInMonth; i++) {
    const d = new Date(year, month, i);
    calendarDays.push({ date: d, dateStr: toDateStr(d), isCurrentMonth: true });
  }

  const remainingCells = (7 - (calendarDays.length % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    const d = new Date(year, month + 1, i);
    calendarDays.push({ date: d, dateStr: toDateStr(d), isCurrentMonth: false });
  }

  // --- WEEK VIEW LOGIC ---
  // Week Time Budget state & calculations
  const weekDays = useMemo(() => getWeekDates(currentDate), [currentDate]);
  const weekKey = weekDays[0]?.dateStr || 'week';

  const [budgetState, setBudgetState] = useState(() => getStoredWeekBudget(weekKey));

  useEffect(() => {
    setBudgetState(getStoredWeekBudget(weekKey));

    const handleBudgetUpdated = (e: any) => {
      if (e.detail?.weekKey === weekKey) {
        setBudgetState({
          availableMinutes: e.detail.availableMinutes,
          preset: e.detail.preset,
        });
      }
    };
    window.addEventListener('curatecal:budget_updated', handleBudgetUpdated);
    return () => window.removeEventListener('curatecal:budget_updated', handleBudgetUpdated);
  }, [weekKey]);

  const handleBudgetChange = (mins: number, preset: BudgetPreset) => {
    setBudgetState({ availableMinutes: mins, preset });
    saveStoredWeekBudget(weekKey, mins, preset);
    trackEvent('budget_changed', { preset });
  };

  const weekDateSet = useMemo(() => new Set(weekDays.map((w) => w.dateStr)), [weekDays]);

  const { plannedMinutes: weekPlannedMinutes, completedMinutes: weekCompletedMinutes } = useMemo(() => {
    return calculateTimeForDateSet(items, weekDateSet, budgetState.availableMinutes);
  }, [items, weekDateSet, budgetState.availableMinutes]);

  const weekDaySlots: WeekDaySlot[] = useMemo(() => {
    return weekDays.map((wd) => {
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
  }, [weekDays, items, dayThemes]);

  const handleDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverDate !== dateStr) {
      setDragOverDate(dateStr);
    }
  };

  const handleDrop = (e: React.DragEvent, targetDateStr: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.isNewUnsaved && onAddNewItemToDate) {
          onAddNewItemToDate(parsed, targetDateStr);
          return;
        }
        if (parsed.id) {
          onMoveItemToDate(parsed.id, targetDateStr, 'drag');
          return;
        }
      } catch {
        onMoveItemToDate(raw, targetDateStr, 'drag');
      }
    }
  };

  // ----------------------------------------------------
  // DAY VIEW (Serene Focus & Daily Schedule)
  // ----------------------------------------------------
  if (view === 'day') {
    const activeDateStr = toDateStr(currentDate);
    const dayItems = getItemsForDate(activeDateStr);
    const { plannedMinutes: totalMinutes, completedMinutes } = calculateTimeForDate(items, activeDateStr);
    const isToday = activeDateStr === todayStr;

    return (
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-8 py-6">
        {/* Day Navigation Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-stone-200/50 dark:border-stone-850 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-sans text-stone-600 dark:text-stone-300 uppercase tracking-widest font-medium">
                {currentDate.toLocaleDateString('en-US', { weekday: 'long' })}
              </span>
              {isToday && (
                <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-200 font-medium">
                  Today
                </span>
              )}
            </div>
            <h2 className="font-serif text-3xl font-normal text-stone-900 dark:text-stone-100 mt-1">
              {currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </h2>
            {totalMinutes > 0 && (
              <span className="text-xs font-mono text-stone-600 dark:text-stone-300 mt-1 block">
                Total planned: {formatHoursMinutes(totalMinutes)}{completedMinutes > 0 ? ` · Done ${formatHoursMinutes(completedMinutes)}` : ''} · {dayItems.length} {dayItems.length === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex items-center border border-stone-200 dark:border-stone-800 rounded-lg p-0.5 bg-stone-100/50 dark:bg-stone-900/50 text-xs">
              <button
                type="button"
                onClick={() => navigateDay(-1)}
                title="Previous Day"
                className="p-1.5 hover:text-stone-900 dark:hover:text-stone-100 text-stone-500 dark:text-stone-400 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={jumpToToday}
                className="px-2 py-1 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 transition-colors cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => navigateDay(1)}
                title="Next Day"
                className="p-1.5 hover:text-stone-900 dark:hover:text-stone-100 text-stone-400 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => onAddForDate(activeDateStr)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity cursor-pointer shadow-2xs"
            >
              <Plus className="w-3 h-3" />
              <span>Add content</span>
            </button>
          </div>
        </div>

        {/* Content Section */}
        <div
          onDragOver={(e) => handleDragOver(e, activeDateStr)}
          onDragLeave={() => setDragOverDate(null)}
          onDrop={(e) => handleDrop(e, activeDateStr)}
          className={`min-h-[420px] mt-6 transition-colors rounded-2xl ${
            dragOverDate === activeDateStr ? 'bg-stone-100/60 dark:bg-stone-900/40 border border-dashed border-stone-400' : ''
          }`}
        >
          {dayItems.length === 0 ? (
            <div className="py-16 px-6 text-center border border-dashed border-stone-200 dark:border-stone-850 rounded-2xl bg-stone-50/40 dark:bg-stone-900/20">
              <p className="font-serif italic text-stone-500 dark:text-stone-400 text-lg">
                No content scheduled for this day
              </p>
              <p className="text-xs text-stone-400 dark:text-stone-500 font-sans mt-1 max-w-sm mx-auto">
                Drag a card here, add a new link, or pick from your library to schedule.
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onAddForDate(activeDateStr)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-stone-900 text-white dark:bg-stone-100 dark:text-black cursor-pointer hover:opacity-90 transition-opacity"
                >
                  + Add to this day
                </button>
              </div>

              {/* Quick schedule from inbox if available */}
              {inboxItems && inboxItems.length > 0 && (
                <div className="mt-8 pt-6 border-t border-stone-200/50 dark:border-stone-800 text-left">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 block mb-3 text-center sm:text-left">
                    Quick-schedule from your library / inbox:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {inboxItems.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        className="group flex items-center justify-between p-2.5 rounded-xl border border-stone-200/60 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-2xs hover:border-stone-400 dark:hover:border-stone-600 transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-medium text-stone-900 dark:text-stone-100 truncate">
                            {item.title}
                          </p>
                          <span className="text-xs text-stone-600 dark:text-stone-300 capitalize block mt-0.5">
                            {item.contentType} {item.durationMinutes ? `· ${item.durationMinutes}m` : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onMoveItemToDate(item.id, activeDateStr)}
                          className="shrink-0 px-2 py-1 rounded text-[11px] font-sans bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 transition-colors cursor-pointer"
                        >
                          + Plan
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {dayItems.map((item) => {
                const multiDayInfo = getItemMultiDayInfo(item, activeDateStr);
                if (multiDayInfo.isContinuation) {
                  return (
                    <ContinuationMarker
                      key={`${item.id}-cont-${activeDateStr}`}
                      item={item}
                      dayNumber={multiDayInfo.dayNumber}
                      totalDays={multiDayInfo.totalDays}
                      onSelect={onSelectCard}
                    />
                  );
                }
                return (
                  <ContentCard
                    key={item.id}
                    item={item}
                    onSelect={onSelectCard}
                    onToggleComplete={onToggleComplete}
                    onTogglePriority={onTogglePriority}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // WEEK VIEW (Top-to-Bottom Vertical Journal Layout)
  // ----------------------------------------------------
  if (view === 'week') {
    const weekDays = getWeekDates();

    const formatTotalTime = (mins: number) => {
      if (mins <= 0) return null;
      if (mins < 60) return `${mins}m`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h}h ${m}m` : `${h}h`;
    };

    const firstDate = weekDays[0].date;
    const lastDate = weekDays[6].date;
    const weekRangeLabel = `${firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    return (
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-8 py-6 space-y-4">
        {/* Week View Header & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-stone-200/50 dark:border-stone-850 gap-3">
          <div>
            <span className="text-xs font-sans text-stone-600 dark:text-stone-300 uppercase tracking-widest font-medium">
              Weekly Flow (Top-to-Bottom)
            </span>
            <h2 className="font-serif text-2xl font-normal text-stone-900 dark:text-stone-100 mt-0.5">
              {weekRangeLabel}
            </h2>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="flex items-center border border-stone-200 dark:border-stone-800 rounded-lg p-0.5 bg-stone-100/50 dark:bg-stone-900/50 text-xs">
              <button
                type="button"
                onClick={() => navigateWeek(-1)}
                title="Previous Week"
                className="p-1.5 hover:text-stone-900 dark:hover:text-stone-100 text-stone-500 dark:text-stone-400 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={jumpToToday}
                className="px-2 py-1 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 transition-colors cursor-pointer"
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => navigateWeek(1)}
                title="Next Week"
                className="p-1.5 hover:text-stone-900 dark:hover:text-stone-100 text-stone-400 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {onOpenWeeklyReview && (
              <button
                type="button"
                onClick={onOpenWeeklyReview}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-850 transition-colors cursor-pointer shadow-2xs"
                title="Review previous-week totals & triage unfinished items"
              >
                <RotateCcw className="w-3 h-3 text-stone-400" />
                <span>Weekly Review</span>
                {prevWeekData.totals.unfinishedCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Start-of-Week Review Banner (Non-intrusive, dismissible) */}
        {!isBannerDismissed &&
          (prevWeekData.totals.totalItemsCount > 0 ||
            prevWeekData.totals.unfinishedCount > 0) && (
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 text-xs font-sans text-stone-700 dark:text-stone-300 animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span>
                  <strong className="font-medium text-stone-900 dark:text-stone-100">
                    New week
                  </strong>{' '}
                  · Previous week ({prevWeekData.range.label}):{' '}
                  <span className="tabular-nums font-mono font-medium text-stone-900 dark:text-stone-100">
                    {formatHoursMinutes(prevWeekData.totals.completedMinutes)}
                  </span>{' '}
                  /{' '}
                  <span className="tabular-nums font-mono text-stone-600 dark:text-stone-400">
                    {formatHoursMinutes(prevWeekData.totals.plannedMinutes)}
                  </span>{' '}
                  completed
                  {prevWeekData.totals.unfinishedCount > 0 && (
                    <span className="text-amber-700 dark:text-amber-400 font-medium ml-1">
                      ({prevWeekData.totals.unfinishedCount} unfinished)
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                {onOpenWeeklyReview && (
                  <button
                    type="button"
                    onClick={onOpenWeeklyReview}
                    className="px-3 py-1 rounded-full text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity cursor-pointer shadow-2xs"
                  >
                    Review Previous Week →
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDismissBanner}
                  className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors cursor-pointer"
                  title="Dismiss banner"
                  aria-label="Dismiss banner"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

        {/* Time Budget Status & Quick Plan Header (Sticky above week columns) */}
        <TimeBudgetHeader
          availableMinutes={budgetState.availableMinutes}
          plannedMinutes={weekPlannedMinutes}
          completedMinutes={weekCompletedMinutes}
          currentPreset={budgetState.preset}
          onBudgetChange={handleBudgetChange}
          onOpenQuickPlan={() => {
            if (onOpenQuickPlan) {
              onOpenQuickPlan(budgetState.availableMinutes);
            } else {
              setIsQuickPlanOpen(true);
            }
          }}
          canQuickPlan={inboxItems.length > 0}
        />

        {/* 7 Days: Monday to Sunday arranged from top to bottom */}
        {weekDays.map((wd, colIdx) => {
          const dayItems = getItemsForDate(wd.dateStr);
          const isToday = wd.dateStr === todayStr;
          const isDragOver = dragOverDate === wd.dateStr;
          const { plannedMinutes: dayPlannedMinutes } = calculateTimeForDate(items, wd.dateStr);

          return (
            <div
              key={wd.dateStr}
              onDragOver={(e) => handleDragOver(e, wd.dateStr)}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={(e) => handleDrop(e, wd.dateStr)}
              className={`flex flex-col sm:flex-row items-start gap-4 p-4 rounded-2xl border transition-all ${
                isDragOver
                  ? 'bg-stone-100 dark:bg-stone-900 border-stone-400 dark:border-stone-600'
                  : isToday
                  ? 'bg-white/80 dark:bg-stone-900/40 border-stone-300 dark:border-stone-800 shadow-2xs'
                  : 'bg-transparent border-stone-200/50 dark:border-stone-850 hover:border-stone-300 dark:hover:border-stone-800'
              }`}
            >
              {/* Day Header Column */}
              <div className="w-full sm:w-44 shrink-0 flex sm:flex-col justify-between sm:justify-start items-baseline sm:items-start gap-1 pb-2 sm:pb-0 border-b sm:border-b-0 border-stone-200/40 dark:border-stone-850">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-serif text-lg sm:text-xl font-normal ${
                    isToday ? 'font-semibold text-black dark:text-white' : 'text-stone-800 dark:text-stone-200'
                    }`}
                  >
                    {dayOfWeekNames[colIdx]}
                  </span>
                  {isToday && (
                    <span className="w-1.5 h-1.5 rounded-full bg-black dark:bg-white" />
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-stone-400 font-sans">
                  <span>{wd.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  {dayPlannedMinutes > 0 && <span>· {formatHoursMinutes(dayPlannedMinutes)}</span>}
                </div>

                <button
                  type="button"
                  onClick={() => onAddForDate(wd.dateStr)}
                  className="hidden sm:inline-flex items-center gap-1 text-[11px] font-sans text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 mt-2 transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add content</span>
                </button>
              </div>

              {/* Cards Gallery Stream across the day row */}
              <div className="flex-1 w-full min-w-0">
                {dayItems.length === 0 ? (
                  <div
                    onClick={() => onAddForDate(wd.dateStr)}
                    className="h-18 rounded-xl border border-dashed border-stone-200/60 dark:border-stone-850 flex items-center justify-center text-xs text-stone-400 dark:text-stone-600 hover:text-stone-600 dark:hover:text-stone-400 hover:border-stone-300 cursor-pointer transition-colors"
                  >
                    + Drop card here or click to plan
                  </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {dayItems.map((item) => {
                        const multiDayInfo = getItemMultiDayInfo(item, wd.dateStr);
                        if (multiDayInfo.isContinuation) {
                          return (
                            <ContinuationMarker
                              key={`${item.id}-cont-${wd.dateStr}`}
                              item={item}
                              dayNumber={multiDayInfo.dayNumber}
                              totalDays={multiDayInfo.totalDays}
                              onSelect={onSelectCard}
                            />
                          );
                        }
                        return (
                          <ContentCard
                            key={item.id}
                            item={item}
                            onSelect={onSelectCard}
                            onToggleComplete={onToggleComplete}
                            onTogglePriority={onTogglePriority}
                            compact
                          />
                        );
                      })}
                    </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ----------------------------------------------------
  // MONTH VIEW (Cosmos Gallery Matrix)
  // ----------------------------------------------------
  return (
    <div className="w-full px-4 sm:px-8 py-4 max-w-7xl mx-auto">
      {/* Month Subheader: Weekday headers + Display Mode Toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex-1 grid grid-cols-7 text-center">
          {dayOfWeekNames.map((dayName) => (
            <div key={dayName} className="py-2 text-xs font-sans tracking-widest text-stone-600 dark:text-stone-300 uppercase font-medium">
              {dayName}
            </div>
          ))}
        </div>
      </div>

      {/* Grid: Hairline architectural dividers */}
      <div className="grid grid-cols-7 border-t border-l border-stone-200/50 dark:border-stone-850 auto-rows-fr">
        {calendarDays.map((calDay) => {
          const dayItems = getItemsForDate(calDay.dateStr);
          const isToday = calDay.dateStr === todayStr;
          const isDragOver = dragOverDate === calDay.dateStr;

          const maxVisible = monthlyStyle === 'visual' ? 2 : 3;
          const visibleItems = dayItems.slice(0, maxVisible);
          const hiddenCount = Math.max(0, dayItems.length - maxVisible);

          return (
            <div
              key={calDay.dateStr}
              onClick={() => {
                onDateChange?.(calDay.date);
              }}
              onDragOver={(e) => handleDragOver(e, calDay.dateStr)}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={(e) => handleDrop(e, calDay.dateStr)}
              className={`group relative flex flex-col border-r border-b border-stone-200/50 dark:border-stone-850 transition-colors p-1.5 sm:p-2 min-h-[140px] sm:min-h-[160px] lg:min-h-[180px] cursor-pointer ${
                !calDay.isCurrentMonth
                  ? 'bg-stone-50/20 dark:bg-stone-950/20 opacity-30'
                  : isDragOver
                  ? 'bg-stone-100/90 dark:bg-stone-900/90'
                  : 'bg-transparent hover:bg-stone-50/40 dark:hover:bg-stone-900/20'
              }`}
            >
              {/* Day Number */}
              <div className="flex items-center justify-between mb-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDateChange?.(calDay.date);
                    onViewChange?.('day');
                  }}
                  title="View this day"
                  className={`font-serif text-xs tabular-nums cursor-pointer transition-transform hover:scale-110 ${
                    isToday
                      ? 'w-5 h-5 rounded-full bg-black text-white dark:bg-white dark:text-black flex items-center justify-center font-sans text-xs font-medium'
                      : calDay.isCurrentMonth
                      ? 'text-stone-700 dark:text-stone-300 hover:text-black dark:hover:text-white font-medium'
                      : 'text-stone-400 dark:text-stone-600'
                  }`}
                >
                  {calDay.date.getDate()}
                </button>

                {/* Subtle Add on hover */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddForDate(calDay.dateStr);
                  }}
                  title="Add to date"
                  className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-opacity p-0.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Monthly Visual Cards (Thumbnail, Headline, Creator/Author, Time) */}
              <div className="flex-1 space-y-2 overflow-hidden">
                {visibleItems.map((item) => {
                  const multiDayInfo = getItemMultiDayInfo(item, calDay.dateStr);
                  if (multiDayInfo.isContinuation) {
                    return (
                      <ContinuationMarker
                        key={`${item.id}-cont-${calDay.dateStr}`}
                        item={item}
                        dayNumber={multiDayInfo.dayNumber}
                        totalDays={multiDayInfo.totalDays}
                        onSelect={onSelectCard}
                        compact
                      />
                    );
                  }
                  return (
                    <ContentCard
                      key={item.id}
                      item={item}
                      onSelect={onSelectCard}
                      onToggleComplete={onToggleComplete}
                      onTogglePriority={onTogglePriority}
                      compact
                      variant={monthlyStyle}
                    />
                  );
                })}
              </div>

              {/* + X more */}
              {hiddenCount > 0 && (
                <button
                  onClick={() => onOpenDayDrawer(calDay.dateStr)}
                  className="mt-1 text-[10px] font-sans text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors flex items-center gap-0.5 cursor-pointer self-start"
                >
                  <span>+{hiddenCount} more</span>
                  <ChevronRight className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Plan Modal (Interactive Preview & Advanced Planning Rules) */}
      <QuickPlanModal
        isOpen={isQuickPlanOpen}
        onClose={() => setIsQuickPlanOpen(false)}
        onApply={(assignments) => {
          onApplyQuickPlan?.(assignments);
          setIsQuickPlanOpen(false);
        }}
        weekDays={weekDaySlots}
        inboxItems={inboxItems}
        existingWeekItems={items.filter(
          (it) =>
            it.scheduledDate &&
            new Set(weekDays.map((w) => w.dateStr)).has(it.scheduledDate)
        )}
        availableBudgetMinutes={budgetState.availableMinutes}
        dayThemes={dayThemes}
        onNavigateNextWeek={() => navigateWeek(1)}
      />
    </div>
  );
};
