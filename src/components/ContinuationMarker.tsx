import React from 'react';
import { ArrowRight } from 'lucide-react';
import { ContentItem } from '../types';

interface ContinuationMarkerProps {
  item: ContentItem;
  dayNumber: number;
  totalDays: number;
  onSelect: (item: ContentItem) => void;
  compact?: boolean;
}

export const ContinuationMarker: React.FC<ContinuationMarkerProps> = ({
  item,
  dayNumber,
  totalDays,
  onSelect,
  compact = false,
}) => {
  return (
    <div
      onClick={() => onSelect(item)}
      className={`group flex items-center justify-between gap-2 rounded-xl border border-dashed border-stone-300 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/40 hover:bg-white dark:hover:bg-stone-850 hover:border-stone-400 dark:hover:border-stone-700 transition-all cursor-pointer shadow-2xs select-none ${
        compact ? 'p-1.5 text-xs' : 'p-2.5 sm:px-3 text-xs'
      }`}
      title={`${item.title} · Continues (day ${dayNumber} of ${totalDays})`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
        <span className="font-serif text-[12px] sm:text-[13px] text-stone-700 dark:text-stone-300 truncate font-normal group-hover:text-black dark:group-hover:text-white">
          {item.title}
        </span>
      </div>
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-stone-600 dark:text-stone-300 bg-stone-200/70 dark:bg-stone-800 px-2 py-0.5 rounded-md font-medium">
        day {dayNumber} of {totalDays}
      </span>
    </div>
  );
};
