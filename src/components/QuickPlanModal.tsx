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
  Sparkles,
  ArrowRight,
  ShieldCheck,
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

interface QuickPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (assignments: { itemId: string; targetDateStr: string }[]) => void;
  weekDays: WeekDaySlot[];
  inboxItems: ContentItem[];
  existingWeekItems: ContentItem[];
  availableBudgetMinutes: number;
  dayThemes: DayTheme[];
}

export const QuickPlanModal: React.FC<QuickPlanModalProps> = ({
  isOpen,
  onClose,
  onApply,
  weekDays,
  inboxItems,
  existingWeekItems,
  availableBudgetMinutes,
  dayThemes,
}) => {
  const [strategy, setStrategy] = useState<PlanningStrategy>('thematic_balanced');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Local state for editable proposals
  const [assignedDays, setAssignedDays] = useState<Record<string, string>>({}); // itemId -> dateStr
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Generate deterministic plan proposal
  const generatedPlan: QuickPlanResult = useMemo(() => {
    return generateQuickPlan({
      inboxItems,
      existingWeekItems,
      weekDays,
      availableBudgetMinutes,
      dayThemes,
      strategy,
    });
  }, [
    inboxItems,
    existingWeekItems,
    weekDays,
    availableBudgetMinutes,
    dayThemes,
    strategy,
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
              <Zap className="w-4 h-4 fill-current text-amber-400 dark:text-amber-500" />
            </div>
            <div>
              <h2 className="font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
                Quick Plan Preview
              </h2>
              <p className="text-[11px] font-sans text-stone-500 dark:text-stone-400">
                Deterministic scheduling · Leaves ~10–20% buffer free
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
              <span className={`font-medium ${isOverBudget ? 'text-rose-500 font-semibold' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {isOverBudget ? `OVER BUDGET (+${formatHoursMinutes(projectedTotal - availableBudgetMinutes)})` : formatHoursMinutes(remainingAfterPlan)}
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
            <span>{showAdvanced ? 'Hide Rules' : 'Advanced Rules'}</span>
          </button>
        </div>

        {/* Strategy Selector (Advanced or Collapsed) */}
        {showAdvanced && (
          <div className="px-5 sm:px-6 py-3 border-b border-stone-200 dark:border-stone-800 bg-white/50 dark:bg-stone-900/30">
            <span className="text-[11px] font-mono text-stone-400 block mb-2 uppercase tracking-wider">
              Planning Rule
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'thematic_balanced', label: 'Thematic Balanced', desc: 'Category grouping & 15% buffer' },
                { id: 'oldest_first', label: 'Oldest First', desc: 'Process backlog backlog chronologically' },
                { id: 'shortest_first', label: 'Shortest First', desc: 'Quick wins & micro-sessions' },
                { id: 'alternate_type', label: 'Alternate Type', desc: 'Video → Article → Podcast → Book' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStrategy(s.id as PlanningStrategy)}
                  className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                    strategy === s.id
                      ? 'border-black dark:border-white bg-black/5 dark:bg-white/5'
                      : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
                  }`}
                >
                  <span className="block font-sans text-xs font-medium text-stone-900 dark:text-stone-100">
                    {s.label}
                  </span>
                  <span className="block text-[10px] text-stone-400 line-clamp-1 mt-0.5">
                    {s.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Proposed Schedule Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {generatedPlan.proposedItems.length === 0 ? (
            <div className="py-12 text-center text-stone-400 space-y-2">
              <p className="font-serif italic text-base">No inbox items eligible for planning.</p>
              <p className="text-xs font-sans text-stone-500 max-w-sm mx-auto">
                Add content to your Inbox, or expand your weekly time budget to schedule more items.
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
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-amber-600 dark:text-amber-400">
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

                        {/* Explainable Tag */}
                        <div className="mt-1.5 text-[11px] font-sans text-stone-500 dark:text-stone-400 flex items-center gap-1">
                          <span className="text-stone-400">Why:</span>
                          <span className="font-medium text-stone-700 dark:text-stone-300">
                            {pi.explanation}
                          </span>
                        </div>
                      </div>

                      {/* Day Assignment Dropdown */}
                      <div className="shrink-0">
                        <select
                          value={currentDay}
                          disabled={!isChecked}
                          onChange={(e) => handleDayChange(pi.item.id, e.target.value)}
                          className="bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 text-xs font-sans rounded-lg px-2.5 py-1.5 border border-stone-200 dark:border-stone-700 focus:outline-hidden cursor-pointer disabled:opacity-40"
                        >
                          {weekDays.map((wd) => (
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
              <span>Apply Schedule</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
