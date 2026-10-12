import React from 'react';
import { X, RotateCcw } from 'lucide-react';
import { FilterState, CONTENT_TYPE_CONFIG } from '../types';

interface FilterBarProps {
  isOpen: boolean;
  filters: FilterState;
  onFilterChange: (updates: Partial<FilterState>) => void;
  onResetFilters: () => void;
  availableTopics: string[];
  totalMatches: number;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  isOpen,
  filters,
  onFilterChange,
  onResetFilters,
  availableTopics,
  totalMatches,
}) => {
  if (!isOpen) return null;

  const hasActiveFilters =
    filters.topic !== '' ||
    filters.contentType !== '' ||
    filters.status !== 'all' ||
    filters.searchQuery !== '';

  return (
    <div className="bg-stone-100/90 dark:bg-stone-900/90 border-b border-stone-200 dark:border-stone-800 px-4 py-3 transition-all animate-in fade-in slide-in-from-top-1">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Topic Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500">
              Topic:
            </span>
            <select
              value={filters.topic}
              onChange={(e) => onFilterChange({ topic: e.target.value })}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-xs font-sans text-stone-800 dark:text-stone-200 focus:outline-hidden"
            >
              <option value="">All Topics</option>
              {availableTopics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Content Type Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500">
              Type:
            </span>
            <select
              value={filters.contentType}
              onChange={(e) => onFilterChange({ contentType: e.target.value })}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-xs font-sans text-stone-800 dark:text-stone-200 focus:outline-hidden"
            >
              <option value="">All Types</option>
              {Object.entries(CONTENT_TYPE_CONFIG).map(([typeKey, cfg]) => (
                <option key={typeKey} value={typeKey}>
                  {cfg.icon} {cfg.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-stone-500">
              Status:
            </span>
            <select
              value={filters.status}
              onChange={(e) => onFilterChange({ status: e.target.value })}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-xs font-sans text-stone-800 dark:text-stone-200 focus:outline-hidden"
            >
              <option value="all">All Content</option>
              <option value="planned">Planned (Unfinished)</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed Only</option>
              <option value="inbox">Inbox (Unscheduled)</option>
            </select>
          </div>

          {/* Matches Counter */}
          <span className="text-xs text-stone-500 font-mono tabular-nums">
            Showing {totalMatches} {totalMatches === 1 ? 'item' : 'items'}
          </span>
        </div>

        {/* Reset button */}
        {hasActiveFilters && (
          <button
            onClick={onResetFilters}
            className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-200 font-sans"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset filters</span>
          </button>
        )}
      </div>
    </div>
  );
};
