import React, { useState, useRef, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { ContentItem } from '../types';
import { formatDuration } from '../lib/timeAccounting';

export const DURATION_PRESET_OPTIONS = [
  { minutes: 10, label: '10m' },
  { minutes: 20, label: '20m' },
  { minutes: 30, label: '30m' },
  { minutes: 45, label: '45m' },
  { minutes: 60, label: '1h' },
  { minutes: 90, label: '90m' },
  { minutes: 120, label: '2h' },
  { minutes: 180, label: '3h' },
] as const;

interface DurationChipsProps {
  currentMinutes?: number;
  onSelectDuration: (minutes: number) => void;
  className?: string;
  chipSize?: 'xs' | 'sm' | 'md';
}

export const DurationChips: React.FC<DurationChipsProps> = ({
  currentMinutes,
  onSelectDuration,
  className = '',
  chipSize = 'sm',
}) => {
  const [customVal, setCustomVal] = useState('');
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  const handleApplyCustom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const val = parseInt(customVal.trim(), 10);
    if (!isNaN(val) && val > 0 && val <= 1440) {
      onSelectDuration(val);
      setCustomVal('');
      setIsCustomOpen(false);
    }
  };

  const sizeClasses =
    chipSize === 'xs'
      ? 'px-2 py-0.5 text-[11px]'
      : chipSize === 'md'
      ? 'px-3 py-1.5 text-xs'
      : 'px-2.5 py-1 text-xs';

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {DURATION_PRESET_OPTIONS.map((preset) => {
          const isSelected = currentMinutes === preset.minutes;
          return (
            <button
              key={preset.minutes}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDuration(preset.minutes);
              }}
              className={`${sizeClasses} font-mono rounded-lg transition-all cursor-pointer ${
                isSelected
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 font-semibold shadow-2xs'
                  : 'bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsCustomOpen(!isCustomOpen);
          }}
          className={`${sizeClasses} font-sans rounded-lg transition-colors cursor-pointer border ${
            isCustomOpen
              ? 'border-stone-400 bg-stone-200 dark:border-stone-600 dark:bg-stone-700 text-stone-900 dark:text-stone-100'
              : 'border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-400'
          }`}
        >
          Custom
        </button>
      </div>

      {isCustomOpen && (
        <form
          onSubmit={handleApplyCustom}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 pt-1"
        >
          <input
            type="number"
            min={1}
            max={1440}
            value={customVal}
            onChange={(e) => setCustomVal(e.target.value)}
            placeholder="Minutes (e.g. 50)"
            autoFocus
            className="w-28 px-2 py-1 text-xs font-mono rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-hidden focus:ring-1 focus:ring-stone-400"
          />
          <button
            type="submit"
            disabled={!customVal.trim()}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 disabled:opacity-40 cursor-pointer shadow-2xs"
          >
            Apply
          </button>
        </form>
      )}
    </div>
  );
};

interface DurationBadgeWithPickerProps {
  item: ContentItem;
  onUpdateDuration?: (id: string, minutes: number) => void;
  className?: string;
  showIcon?: boolean;
}

export const DurationBadgeWithPicker: React.FC<DurationBadgeWithPickerProps> = ({
  item,
  onUpdateDuration,
  className = '',
  showIcon = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const durationStr = formatDuration(item.durationMinutes);
  if (!durationStr && !onUpdateDuration) return null;

  const isEstimate = item.durationIsEstimate !== false;
  const label = durationStr ? `${durationStr}${isEstimate ? ' est.' : ''}` : '+ Set duration';

  const handleSelect = (mins: number) => {
    onUpdateDuration?.(item.id, mins);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (onUpdateDuration) {
            setIsOpen((prev) => !prev);
          }
        }}
        title={onUpdateDuration ? `Duration: ${label} (Click for 1-tap editing)` : `Duration: ${label}`}
        className={`inline-flex items-center gap-1 font-mono text-xs tabular-nums transition-colors ${
          onUpdateDuration
            ? 'cursor-pointer hover:text-stone-950 dark:hover:text-stone-50 hover:bg-stone-200/50 dark:hover:bg-stone-800/80 px-1 py-0.5 rounded-md -mx-1'
            : ''
        } ${className}`}
      >
        {showIcon && <Clock className="w-3 h-3 text-stone-400" />}
        <span>{label}</span>
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 right-0 sm:left-0 sm:right-auto mt-1.5 p-3 w-72 bg-white dark:bg-[#1a1918] rounded-2xl shadow-xl border border-stone-200 dark:border-stone-800 select-none animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-stone-100 dark:border-stone-850">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500">
              One-tap duration
            </span>
            <span className="text-[10px] font-mono text-stone-400">
              {isEstimate ? 'Currently estimated' : 'User edited'}
            </span>
          </div>

          <DurationChips
            currentMinutes={item.durationMinutes}
            onSelectDuration={handleSelect}
          />
        </div>
      )}
    </div>
  );
};
