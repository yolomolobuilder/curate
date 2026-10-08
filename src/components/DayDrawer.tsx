import React from 'react';
import { X, Plus, Clock, Calendar } from 'lucide-react';
import { ContentItem } from '../types';
import { ContentCard } from './ContentCard';
import { ContinuationMarker } from './ContinuationMarker';
import {
  calculateTimeForDate,
  formatHoursMinutes,
  getItemMultiDayInfo,
} from '../lib/timeAccounting';

interface DayDrawerProps {
  dateStr: string | null;
  isOpen: boolean;
  onClose: () => void;
  items: ContentItem[];
  onSelectCard: (item: ContentItem) => void;
  onToggleComplete: (id: string, e: React.MouseEvent) => void;
  onTogglePriority?: (id: string, e: React.MouseEvent) => void;
  onAddForDate: (dateStr: string) => void;
}

export const DayDrawer: React.FC<DayDrawerProps> = ({
  dateStr,
  isOpen,
  onClose,
  items,
  onSelectCard,
  onToggleComplete,
  onTogglePriority,
  onAddForDate,
}) => {
  if (!isOpen || !dateStr) return null;

  const dateObj = new Date(dateStr + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const dayItems = items.filter((item) => {
    if (item.scheduledDate === dateStr) return true;
    if (item.scheduledDate && item.scheduledEndDate) {
      return dateStr >= item.scheduledDate && dateStr <= item.scheduledEndDate;
    }
    return false;
  });

  const { plannedMinutes: totalMinutes, completedMinutes } = calculateTimeForDate(items, dateStr);

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-[#FAF8F5] dark:bg-[#181716] shadow-2xl border-l border-stone-200 dark:border-stone-800 flex flex-col">
      {/* Header */}
      <div className="p-5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
        <div>
          <span className="text-xs font-mono uppercase tracking-widest text-stone-500">
            Day Schedule
          </span>
          <h3 className="font-serif text-xl font-semibold text-stone-900 dark:text-stone-100 mt-0.5">
            {formattedDate}
          </h3>
          {totalMinutes > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300 font-mono mt-1">
              <Clock className="w-3.5 h-3.5" />
              <span>
                Total Planned: {formatHoursMinutes(totalMinutes)}
                {completedMinutes > 0 ? ` · Done ${formatHoursMinutes(completedMinutes)}` : ''} ({dayItems.length} {dayItems.length === 1 ? 'item' : 'items'})
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Items list */}
      <div className="flex-1 p-5 overflow-y-auto space-y-4">
        {dayItems.length === 0 ? (
          <div className="py-16 text-center text-xs text-stone-500">
            No items scheduled on this date.
          </div>
        ) : (
          dayItems.map((item) => {
            const multiDayInfo = getItemMultiDayInfo(item, dateStr);
            if (multiDayInfo.isContinuation) {
              return (
                <ContinuationMarker
                  key={`${item.id}-cont-${dateStr}`}
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
          })
        )}
      </div>

      {/* Footer Add */}
      <div className="p-4 border-t border-stone-200 dark:border-stone-800 flex items-center justify-end">
        <button
          onClick={() => onAddForDate(dateStr)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-white bg-stone-900 hover:bg-stone-800 dark:bg-amber-600 transition-colors shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add to this day</span>
        </button>
      </div>
    </div>
  );
};
