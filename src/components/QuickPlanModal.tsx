import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Zap,
  Calendar,
  Clock,
  Star,
  Check,
  AlertCircle,
  Sliders,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import {
  ContentItem,
  DayTheme,
  PlanningStrategy,
  QuickPlanResult,
} from '../types';
import {
  generateQuickPlan,
  WeekDaySlot,
  getEstimatedDuration,
} from '../lib/quickPlanner';
import { formatHoursMinutes } from '../lib/timeAccounting';
import { getTodayStr } from '../lib/dateUtils';
import { getStoredDayPreferencesEnabled } from '../lib/storage';
import { trackEvent } from '../lib/analytics';

interface QuickPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (assignments: { itemId: string; targetDateStr: string }[]) => void;
  weekDays: WeekDaySlot[];
  inboxItems: ContentItem[];
  existingWeekItems: ContentItem[];
  availableBudgetMinutes: number;
  dayThemes: DayTheme[];
  onNavigateNextWeek?: () => void;
}

export const QuickPlanModal: React.FC<QuickPlanModalProps> = ({
  isOpen,
  onClose,
  onApply,
  weekDays = [],
  inboxItems = [],
  existingWeekItems = [],
  availableBudgetMinutes = 0,
  dayThemes = [],
  onNavigateNextWeek,
}) => {
  // Default strategy: 'priority_oldest' ("Priority, then oldest", duration breaks ties)
  const [strategy, setStrategy] = useState<PlanningStrategy>('priority_oldest');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enableDayPreferences, setEnableDayPreferences] = useState(() =>
    getStoredDayPreferencesEnabled()
  );

  // Sync day preferences if updated from Settings
  useEffect(() => {
    const handler = (e: any) => {
      if (typeof e.detail === 'boolean') {
        setEnableDayPreferences(e.detail);
      }
    };
    window.addEventListener('curatecal:day_preferences_updated', handler);
    return () => window.removeEventListener('curatecal:day_preferences_updated', handler);
  }, []);

  // Local state for editable proposals
  const [assignedDays, setAssignedDays] = useState<Record<string, string>>({}); // itemId -> dateStr
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const todayStr = useMemo(() => getTodayStr(), []);

  // Eligible days from today onward in this week
  const eligibleDays = useMemo(() => {
    if (!weekDays || weekDays.length === 0) return [];
    return weekDays.filter((wd) => wd.dateStr >= todayStr);
  }, [weekDays, todayStr]);

  // Generate deterministic plan proposal
  const generatedPlan: QuickPlanResult = useMemo(() => {
    return generateQuickPlan({
      inboxItems,
      existingWeekItems,
      weekDays,
      availableBudgetMinutes,
      dayThemes,
      strategy,
      enableDayPreferences,
    });
  }, [
    inboxItems,
    existingWeekItems,
    weekDays,
    availableBudgetMinutes,
    dayThemes,
    strategy,
    enableDayPreferences,
  ]);

  // Sync proposal state when generatedPlan changes
  useEffect(() => {
    const days: Record<string, string> = {};
    const selected = new Set<string>();
    generatedPlan.proposedItems.forEach((pi) => {
      days[pi.item.id] = pi.targetDateStr;
      selected.add(pi.item.id);
    });
    setAssignedDays(days);
    setSelectedItemIds(selected);
  }, [generatedPlan]);

  useEffect(() => {
    if (isOpen) {
      trackEvent('quick_plan_previewed');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleItemSelection = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDayChange = (itemId: string, newDateStr: string) => {
    setAssignedDays((prev) => ({ ...prev, [itemId]: newDateStr }));
  };

  // Compute live preview metrics based on user edits
  const activeProposedItems = generatedPlan.proposedItems.filter((pi) =>
    selectedItemIds.has(pi.item.id)
  );

  const proposedNewMinutes = activeProposedItems.reduce(
    (acc, pi) => acc + getEstimatedDuration(pi.item),
    0
  );

  const initialMins = generatedPlan.initialScheduledMinutes;
  const projectedTotal = initialMins + proposedNewMinutes;
  const remainingAfterPlan = Math.max(0, availableBudgetMinutes - projectedTotal);
  const isOverBudget = projectedTotal > availableBudgetMinutes;

  const handleApply = () => {
    const assignments = activeProposedItems.map((pi) => ({
      itemId: pi.item.id,
      targetDateStr: assignedDays[pi.item.id] || pi.targetDateStr,
    }));
    onApply(assignments);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs select-none">
      <div className="relative w-full max-w-2xl max-h-[92vh] bg-[#FAF9F6] dark:bg-[#141414] rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 flex flex-col overflow-hidden animate-in fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181818]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shadow-2xs">
              <Zap className="w-4 h-4 fill-current text-stone-400 dark:text-stone-500" />
            </div>
            <div>
              <h2 className="font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
                Quick Plan Preview
              </h2>
              <p className="text-[11px] font-sans text-stone-500 dark:text-stone-400">
                Plans from today onward · Caps at 85% of budget
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Metrics HUD */}
        <div className="px-5 sm:px-6 py-3 bg-stone-100/70 dark:bg-stone-900/60 border-b border-stone-200/60 dark:border-stone-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-[10px] font-mono text-stone-400 uppercase block">Selected</span>
              <span className="font-medium text-stone-900 dark:text-stone-100">
                {activeProposedItems.length} items ({formatHoursMinutes(proposedNewMinutes)})
              </span>
            </div>
            <div className="h-6 w-px bg-stone-200 dark:bg-stone-800" />
            <div>
              <span className="text-[10px] font-mono text-stone-400 uppercase block">Total Week</span>
              <span className="font-medium text-stone-900 dark:text-stone-100">
                {formatHoursMinutes(projectedTotal)} / {formatHoursMinutes(availableBudgetMinutes)}
              </span>
            </div>
            <div className="h-6 w-px bg-stone-200 dark:bg-stone-800" />
            <div>
              <span className="text-[10px] font-mono text-stone-400 uppercase block">Remaining</span>
              <span className={`font-medium tabular-nums ${isOverBudget ? 'text-stone-800 dark:text-stone-200 font-semibold' : 'text-stone-700 dark:text-stone-300'}`}>
                {isOverBudget ? `Over budget (+${formatHoursMinutes(projectedTotal - availableBudgetMinutes)})` : formatHoursMinutes(remainingAfterPlan)}
              </span>
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[11px] font-sans text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Sliders className="w-3 h-3" />
            <span>{showAdvanced ? 'Hide Rules' : 'Strategy Options'}</span>
          </button>
        </div>

        {/* Strategy Selector (Advanced or Collapsed) */}
        {showAdvanced && (
          <div className="px-5 sm:px-6 py-3 border-b border-stone-200 dark:border-stone-800 bg-white/50 dark:bg-stone-900/30">
            <span className="text-[11px] font-mono text-stone-400 block mb-2 uppercase tracking-wider">
              Planning Strategy
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                {
                  id: 'priority_oldest',
                  label: 'Priority, then oldest (Default)',
                  desc: 'Starred items first, then oldest backlog items (duration breaks ties)',
                },
                {
                  id: 'shortest_first',
                  label: 'Shortest first',
                  desc: 'Priority first, then shortest duration for quick wins',
                },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStrategy(s.id as PlanningStrategy)}
                  className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer ${
                    strategy === s.id
                      ? 'border-black dark:border-white bg-black/5 dark:bg-white/5 shadow-2xs'
                      : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
                  }`}
                >
                  <span className="block font-sans text-xs font-semibold text-stone-900 dark:text-stone-100">
                    {s.label}
                  </span>
                  <span className="block text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                    {s.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Proposed Schedule Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* No days remaining banner (Rule 1) */}
          {generatedPlan.noDaysRemainingThisWeek && (
            <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-850 border border-stone-200 dark:border-stone-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div>
                <span className="font-semibold text-stone-900 dark:text-stone-100 block">
                  No days remain this week
                </span>
                <p className="text-stone-500 dark:text-stone-400 text-[11px] mt-0.5">
                  All days in the currently viewed week have already passed from today onward.
                </p>
              </div>
              {onNavigateNextWeek && (
                <button
                  type="button"
                  onClick={() => {
                    onNavigateNextWeek();
                  }}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity cursor-pointer shrink-0 shadow-2xs flex items-center gap-1 self-start sm:self-auto"
                >
                  <span>Plan Next Week</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Proposed items list */}
          {generatedPlan.proposedItems.length === 0 ? (
            <div className="py-8 text-center text-stone-400 space-y-2">
              <p className="font-serif italic text-base">No items proposed for this week.</p>
              <p className="text-xs font-sans text-stone-500 max-w-sm mx-auto">
                {generatedPlan.noDaysRemainingThisWeek
                  ? 'All days have already passed this week. Plan for next week to schedule upcoming content.'
                  : 'Your week may already be at 85% of budget, or all inbox items exceed the remaining capacity.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 block">
                Proposed Schedule ({activeProposedItems.length} items to add)
              </span>

              {generatedPlan.proposedItems.map((pi) => {
                const isChecked = selectedItemIds.has(pi.item.id);
                const currentDay = assignedDays[pi.item.id] || pi.targetDateStr;

                return (
                  <div
                    key={pi.item.id}
                    className={`p-3.5 rounded-xl border transition-all ${
                      isChecked
                        ? 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 shadow-2xs'
                        : 'bg-stone-100/50 dark:bg-stone-950/40 border-stone-200/40 dark:border-stone-900 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => toggleItemSelection(pi.item.id)}
                        className={`mt-0.5 w-4 h-4 rounded-sm flex items-center justify-center transition-colors cursor-pointer border ${
                          isChecked
                            ? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
                            : 'border-stone-300 dark:border-stone-700 hover:border-stone-400'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </button>

                      {/* Item Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {pi.item.isPriority && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-stone-700 dark:text-stone-300">
                              <Star className="w-3 h-3 fill-current" />
                              <span>Priority</span>
                            </span>
                          )}
                          <h4 className="font-serif text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                            {pi.item.title}
                          </h4>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-stone-500 font-sans mt-0.5">
                          <span className="capitalize">{pi.item.contentType}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{getEstimatedDuration(pi.item)}m</span>
                          <span>·</span>
                          <span className="truncate max-w-[140px] text-stone-400">
                            {pi.item.source || pi.item.author || 'Curate'}
                          </span>
                        </div>

                        {/* Explainable Tag (Rule 6: says why day was chosen) */}
                        <div className="mt-1.5 text-[11px] font-sans text-stone-500 dark:text-stone-400 flex items-start gap-1">
                          <span className="text-stone-400 shrink-0 font-medium">Why:</span>
                          <span className="font-medium text-stone-700 dark:text-stone-300 leading-snug">
                            {pi.explanation}
                          </span>
                        </div>
                      </div>

                      {/* Day Assignment Dropdown (Only days from today onward) */}
                      <div className="shrink-0">
                        <select
                          value={currentDay}
                          disabled={!isChecked}
                          onChange={(e) => handleDayChange(pi.item.id, e.target.value)}
                          className="bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 text-xs font-sans rounded-lg px-2.5 py-1.5 border border-stone-200 dark:border-stone-700 focus:outline-hidden cursor-pointer disabled:opacity-40"
                        >
                          {(eligibleDays.length > 0 ? eligibleDays : weekDays).map((wd) => (
                            <option key={wd.dateStr} value={wd.dateStr}>
                              {wd.dayName} ({wd.date.getMonth() + 1}/{wd.date.getDate()})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Not Scheduled List (Rule 2) */}
          {generatedPlan.notScheduledItems && generatedPlan.notScheduledItems.length > 0 && (
            <div className="space-y-2.5 pt-4 border-t border-stone-200/60 dark:border-stone-800/60">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400 block">
                  Not Scheduled ({generatedPlan.notScheduledItems.length} items)
                </span>
                <span className="text-[10px] font-mono text-stone-400">
                  Reason specified
                </span>
              </div>

              <div className="space-y-2">
                {generatedPlan.notScheduledItems.map(({ item, reason }) => (
                  <div
                    key={`not-sched-${item.id}`}
                    className="p-3 rounded-xl border border-stone-200/50 dark:border-stone-800/60 bg-stone-50/50 dark:bg-stone-900/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.isPriority && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-stone-600 dark:text-stone-400">
                              <Star className="w-3 h-3 fill-current" />
                              <span>Priority</span>
                            </span>
                          )}
                          <h4 className="font-serif text-xs font-medium text-stone-800 dark:text-stone-200 truncate">
                            {item.title}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-stone-500 font-sans mt-0.5">
                          <span className="capitalize">{item.contentType}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{getEstimatedDuration(item)}m</span>
                          <span>·</span>
                          <span className="truncate max-w-[140px] text-stone-400">
                            {item.source || item.author || 'Curate'}
                          </span>
                        </div>
                        <div className="mt-1.5 text-[11px] font-sans text-stone-500 dark:text-stone-400 flex items-baseline gap-1.5">
                          <span className="text-stone-400 shrink-0 font-medium">Reason:</span>
                          <span className="italic text-stone-600 dark:text-stone-400">
                            {reason}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-4 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-[#181818] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-sans text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleApply}
              disabled={activeProposedItems.length === 0}
              className="px-5 py-2.5 rounded-full text-xs font-medium text-white bg-black dark:bg-white dark:text-black hover:opacity-90 transition-opacity cursor-pointer shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <span>Apply Schedule ({activeProposedItems.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
