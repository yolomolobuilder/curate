import React, { useState } from 'react';
import { Check, ExternalLink, Star } from 'lucide-react';
import { ContentItem, getItemSource } from '../types';
import { formatDuration } from '../lib/timeAccounting';
import { DurationBadgeWithPicker } from './DurationEditor';

interface ContentCardProps {
  item: ContentItem;
  onSelect: (item: ContentItem) => void;
  onToggleComplete: (id: string, e: React.MouseEvent) => void;
  onTogglePriority?: (id: string, e: React.MouseEvent) => void;
  onUpdateDuration?: (id: string, durationMinutes: number) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  compact?: boolean;
  variant?: 'visual' | 'text-only';
  disableDrag?: boolean;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  item,
  onSelect,
  onToggleComplete,
  onTogglePriority,
  onUpdateDuration,
  isSelected = false,
  onToggleSelect,
  compact = false,
  variant = 'visual',
  disableDrag = false,
}) => {
  const [imageError, setImageError] = useState(false);
  const isCompleted = item.status === 'completed';
  const source = getItemSource(item);


  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ id: item.id, fromDate: item.scheduledDate })
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  // ----------------------------------------------------
  // TEXT-ONLY VARIANT (Monthly Calendar Cells)
  // ----------------------------------------------------
  if (variant === 'text-only') {
    return (
      <div
        draggable={!disableDrag}
        onDragStart={disableDrag ? undefined : handleDragStart}
        onClick={() => onSelect(item)}
        className={`group relative p-2.5 rounded-lg border transition-all duration-150 select-none ${
          disableDrag ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        } ${
          isSelected ? 'ring-2 ring-amber-500 border-amber-500 bg-amber-50/20 dark:bg-amber-950/20' : ''
        } ${
          isCompleted
            ? 'bg-stone-100/50 dark:bg-stone-900/40 border-stone-200/40 dark:border-stone-850 opacity-50'
            : 'bg-white dark:bg-stone-900/90 border-stone-200/60 dark:border-stone-800/80 hover:border-stone-400 dark:hover:border-stone-600 shadow-2xs'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          {/* Requirement 4: Wrap on word boundaries and truncate with ellipsis after two lines */}
          <h4
            data-clarity-mask="True"
            title={item.title}
            className={`font-serif text-[12px] sm:text-[13px] leading-snug line-clamp-2 break-words font-normal flex-1 ${
              isCompleted
                ? 'text-stone-400 line-through'
                : 'text-stone-900 dark:text-stone-100 group-hover:text-black dark:group-hover:text-white'
            }`}
          >
            {item.title}
          </h4>

          <div className="flex items-center gap-1 shrink-0">
            {onToggleSelect && (
              <button
                type="button"
                onClick={(e) => onToggleSelect(item.id, e)}
                title={isSelected ? 'Deselect item' : 'Select for collection'}
                className={`p-0.5 rounded-sm transition-all cursor-pointer ${
                  isSelected
                    ? 'text-amber-500 opacity-100 font-bold'
                    : 'text-stone-300 dark:text-stone-700 opacity-0 group-hover:opacity-100 hover:text-amber-500'
                }`}
              >
                <Check className={`w-3.5 h-3.5 ${isSelected ? 'stroke-[3]' : ''}`} />
              </button>
            )}
            {onTogglePriority && (
              <button
                type="button"
                onClick={(e) => onTogglePriority(item.id, e)}
                title={item.isPriority ? 'High priority' : 'Mark priority'}
                className={`p-0.5 rounded-sm transition-all cursor-pointer ${
                  item.isPriority
                    ? 'text-amber-500 opacity-100'
                    : 'text-stone-300 dark:text-stone-700 opacity-0 group-hover:opacity-100 hover:text-amber-500'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${item.isPriority ? 'fill-current' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => onToggleComplete(item.id, e)}
              title={isCompleted ? 'Mark uncompleted' : 'Mark completed'}
              className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center transition-all ${
                isCompleted
                  ? 'bg-black text-white dark:bg-white dark:text-black opacity-100 scale-100'
                  : 'border border-stone-300 dark:border-stone-700 opacity-0 group-hover:opacity-100 hover:scale-110'
              }`}
            >
              <Check className="w-2.5 h-2.5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Requirement 2 & 3: Single consistent source field & at least 12px WCAG AA text */}
        <div className="flex items-center justify-between text-xs text-stone-600 dark:text-stone-300 font-sans mt-2 pt-1.5 border-t border-stone-100 dark:border-stone-850/60">
          <span data-clarity-mask="True" className="truncate max-w-[65%] font-medium">
            {source} <span className="opacity-40 font-normal">·</span> <span className="capitalize opacity-75 font-normal">{item.contentType}</span>
          </span>
          <DurationBadgeWithPicker
            item={item}
            onUpdateDuration={onUpdateDuration}
            className="text-stone-500 dark:text-stone-400 shrink-0"
          />
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // VISUAL VARIANT (Weekly, Daily, Cosmos, Grid, Detail)
  // ----------------------------------------------------
  return (
    <div
      draggable={!disableDrag}
      onDragStart={disableDrag ? undefined : handleDragStart}
      onClick={() => onSelect(item)}
      className={`group relative flex flex-col transition-all duration-300 select-none ${
        disableDrag ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${
        isCompleted ? 'opacity-50 hover:opacity-90' : 'opacity-100'
      }`}
    >
      <div
        className={`relative w-full aspect-16/10 rounded-lg sm:rounded-xl overflow-hidden bg-stone-100 dark:bg-stone-900 border transition-all duration-300 group-hover:shadow-md ${
          isSelected
            ? 'ring-2 ring-amber-500 border-amber-500 shadow-md'
            : 'border-stone-200/50 dark:border-stone-800/60'
        } ${
          compact ? 'shadow-2xs' : 'group-hover:scale-[1.015]'
        }`}
      >
        {!imageError && item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className={`w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-104 ${
              isCompleted ? 'grayscale contrast-90' : ''
            }`}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-stone-100 dark:bg-stone-900 text-stone-500">
            <span data-clarity-mask="True" className="font-serif italic text-xs sm:text-sm line-clamp-2 break-words">{item.title}</span>
          </div>
        )}

        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

        {/* Selection Toggle */}
        {onToggleSelect && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item.id, e);
            }}
            title={isSelected ? 'Deselect item' : 'Select for collection'}
            className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${
              isSelected
                ? 'bg-amber-500 text-white opacity-100 scale-100 shadow-sm ring-2 ring-white dark:ring-stone-900'
                : 'bg-black/35 hover:bg-black/80 text-white/90 opacity-40 hover:opacity-100 group-hover:opacity-100 backdrop-blur-xs hover:scale-110 border border-white/30'
            }`}
          >
            <Check className={`w-3.5 h-3.5 ${isSelected ? 'stroke-[3]' : ''}`} />
          </button>
        )}

        {/* Priority Star Toggle (Requirement 3: user answered direct star icon on cards) */}
        {onTogglePriority && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePriority(item.id, e);
            }}
            title={item.isPriority ? 'High priority item (click to remove)' : 'Mark as high priority'}
            className={`absolute top-2 ${onToggleSelect ? 'left-9' : 'left-2'} w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer ${
              item.isPriority
                ? 'bg-amber-400 text-stone-950 opacity-100 scale-100 shadow-sm'
                : 'bg-black/50 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 backdrop-blur-xs hover:scale-110'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${item.isPriority ? 'fill-current' : ''}`} />
          </button>
        )}

        <button
          type="button"
          onClick={(e) => onToggleComplete(item.id, e)}
          title={isCompleted ? 'Mark uncompleted' : 'Mark completed'}
          className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 ${
            isCompleted
              ? 'bg-black text-white dark:bg-white dark:text-black opacity-100 scale-100 shadow-sm'
              : 'bg-black/50 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 backdrop-blur-xs hover:scale-110'
          }`}
        >
          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>

        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open original"
            className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 backdrop-blur-xs hover:bg-black/80 transition-all"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className={`${compact ? 'pt-1.5 px-0.5' : 'pt-2 px-0.5'}`}>
        {/* Requirement 4: Title wraps on word boundaries and truncates with ellipsis after two lines */}
        <h4
          data-clarity-mask="True"
          title={item.title}
          className={`font-serif leading-snug line-clamp-2 break-words font-normal tracking-tight ${
            compact ? 'text-[12px] sm:text-[13px]' : 'text-[13px] sm:text-[14px]'
          } ${
            isCompleted
              ? 'text-stone-400 line-through decoration-stone-300 dark:decoration-stone-700'
              : 'text-stone-900 dark:text-stone-100 group-hover:text-black dark:group-hover:text-white'
          }`}
        >
          {item.title}
        </h4>

        {/* Requirement 2 & 3: Single consistent source field & content type on caption & >=12px text */}
        <div className="text-xs text-stone-600 dark:text-stone-300 font-sans flex items-center justify-between mt-1 tracking-normal">
          <span data-clarity-mask="True" className="truncate max-w-[70%] font-medium">
            {source} <span className="opacity-40 font-normal">·</span> <span className="capitalize opacity-75 font-normal">{item.contentType}</span>
          </span>
          <DurationBadgeWithPicker
            item={item}
            onUpdateDuration={onUpdateDuration}
            className="text-stone-500 dark:text-stone-400 shrink-0"
          />
        </div>
      </div>
    </div>
  );
};
