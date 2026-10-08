import React, { useState } from 'react';
import {
  Clock,
  Zap,
  AlertCircle,
  Check,
  ChevronDown,
  Sliders,
} from 'lucide-react';
import { BudgetPreset, BUDGET_PRESET_MINUTES } from '../types';
import { formatHoursMinutes } from '../lib/timeAccounting';

interface TimeBudgetHeaderProps {
  availableMinutes: number;
  plannedMinutes: number;
  completedMinutes?: number;
  currentPreset: BudgetPreset;
  onBudgetChange: (mins: number, preset: BudgetPreset) => void;
  onOpenQuickPlan: () => void;
  canQuickPlan: boolean;
}

const PRESET_OPTIONS: BudgetPreset[] = [
  '30m',
  '1h',
  '2h',
  '3h',
  '5h',
  '7h',
  '10h',
  'custom',
];

export const TimeBudgetHeader: React.FC<TimeBudgetHeaderProps> = ({
  availableMinutes,
  plannedMinutes,
  completedMinutes = 0,
  currentPreset,
  onBudgetChange,
  onOpenQuickPlan,
  canQuickPlan,
}) => {
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [customInputValue, setCustomInputValue] = useState(() =>
    String(Math.round(availableMinutes))
  );

  const isOverBudget = plannedMinutes > availableMinutes;
  const remainingMinutes = availableMinutes - plannedMinutes;
  const percentUsed =
    availableMinutes > 0 ? Math.min(100, Math.round((plannedMinutes / availableMinutes) * 100)) : 0;

  const handleSelectPreset = (preset: BudgetPreset) => {
    if (preset === 'custom') {
      setIsEditingCustom(true);
      setCustomInputValue(String(availableMinutes));
    } else {
      setIsEditingCustom(false);
      const mins = BUDGET_PRESET_MINUTES[preset];
      onBudgetChange(mins, preset);
    }
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(customInputValue, 10);
    if (!isNaN(val) && val > 0) {
      onBudgetChange(val, 'custom');
      setIsEditingCustom(false);
    }
  };

  return (
    <div className="sticky top-[61px] z-20 w-full mb-6 bg-white/95 dark:bg-[#121212]/95 backdrop-blur-md rounded-2xl border border-stone-200/80 dark:border-stone-800/80 p-3.5 sm:p-4 shadow-xs">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left Section: Time Budget Status & Presets */}
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Main Budget Metrics */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            {/* AVAILABLE */}
            <div className="flex flex-col">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Available
              </span>
              <span className="font-serif text-base sm:text-lg font-medium text-stone-900 dark:text-stone-100 tabular-nums">
                {formatHoursMinutes(availableMinutes)}
              </span>
            </div>

            <div className="h-7 w-px bg-stone-200 dark:bg-stone-800" />

            {/* PLANNED & DONE */}
            <div className="flex flex-col">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Planned
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-base sm:text-lg font-medium text-stone-900 dark:text-stone-100 tabular-nums">
                  {formatHoursMinutes(plannedMinutes)}
                </span>
                <span className="font-sans text-xs text-stone-500 dark:text-stone-400 tabular-nums font-normal">
                  Done {formatHoursMinutes(completedMinutes)}
                </span>
              </div>
            </div>

            <div className="h-7 w-px bg-stone-200 dark:bg-stone-800" />

            {/* REMAINING or OVER BUDGET */}
            <div className="flex flex-col">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
                {isOverBudget ? 'Budget Status' : 'Remaining'}
              </span>
              {isOverBudget ? (
                <span className="inline-flex items-center gap-1 font-sans text-xs sm:text-sm font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>OVER BUDGET (+{formatHoursMinutes(plannedMinutes - availableMinutes)})</span>
                </span>
              ) : (
                <span className="font-serif text-base sm:text-lg font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {formatHoursMinutes(remainingMinutes)}
                </span>
              )}
            </div>
          </div>

          {/* Visual capacity progress bar */}
          <div className="hidden xl:flex flex-col w-36 gap-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-stone-400">
              <span>Capacity</span>
              <span>{percentUsed}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  isOverBudget
                    ? 'bg-rose-500'
                    : percentUsed > 85
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, (plannedMinutes / (availableMinutes || 1)) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Middle & Right Section: Presets & Quick Plan Trigger */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Preset Buttons */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[11px] font-sans text-stone-400 dark:text-stone-500 mr-1 hidden sm:inline">
              Budget:
            </span>
            {PRESET_OPTIONS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`px-2.5 py-1 rounded-full text-xs font-sans transition-all cursor-pointer font-medium ${
                  currentPreset === preset
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 shadow-2xs'
                    : 'bg-stone-100 dark:bg-stone-850 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/70 dark:hover:bg-stone-800'
                }`}
              >
                {preset === 'custom' ? 'Custom' : preset}
              </button>
            ))}
          </div>

          {/* Inline Custom Editor */}
          {isEditingCustom && (
            <form
              onSubmit={handleApplyCustom}
              className="flex items-center gap-1 bg-stone-100 dark:bg-stone-850 px-2 py-1 rounded-full border border-stone-200 dark:border-stone-700 animate-in fade-in"
            >
              <input
                type="number"
                min="5"
                max="3000"
                value={customInputValue}
                onChange={(e) => setCustomInputValue(e.target.value)}
                placeholder="mins"
                className="w-16 bg-transparent text-xs font-mono text-stone-900 dark:text-stone-100 focus:outline-hidden text-center"
                autoFocus
              />
              <span className="text-[10px] text-stone-400 font-sans">mins</span>
              <button
                type="submit"
                className="p-1 rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 hover:opacity-90 transition-opacity"
              >
                <Check className="w-3 h-3" />
              </button>
            </form>
          )}

          {/* Quick Plan CTA Button */}
          <button
            type="button"
            onClick={onOpenQuickPlan}
            disabled={!canQuickPlan}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-sans font-medium text-white bg-black dark:bg-white dark:text-black hover:opacity-90 transition-all cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title="Automatically schedule items within weekly budget"
          >
            <Zap className="w-3.5 h-3.5 fill-current text-amber-400 dark:text-amber-500" />
            <span>Quick Plan</span>
          </button>
        </div>
      </div>
    </div>
  );
};
