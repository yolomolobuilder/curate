import React from 'react';
import { Layers, X, PlusCircle } from 'lucide-react';

interface MultiSelectToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onCreateCollection: () => void;
  maxLimit?: number;
}

export const MultiSelectToolbar: React.FC<MultiSelectToolbarProps> = ({
  selectedCount,
  onClearSelection,
  onCreateCollection,
  maxLimit = 50,
}) => {
  if (selectedCount === 0) return null;

  const isOverLimit = selectedCount > maxLimit;

  return (
    <div className="fixed bottom-6 inset-x-0 z-50 flex justify-center px-4 pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="pointer-events-auto flex items-center gap-3 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-4 py-2.5 rounded-full shadow-2xl border border-stone-800 dark:border-stone-200 backdrop-blur-md">
        <div className="flex items-center gap-2 pr-2 border-r border-stone-700 dark:border-stone-300 text-xs font-medium">
          <Layers className="w-4 h-4 text-amber-400 dark:text-amber-600" />
          <span>
            {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
          </span>
          {isOverLimit && (
            <span className="text-[10px] text-red-400 font-semibold">
              (Max {maxLimit})
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onCreateCollection}
          disabled={isOverLimit}
          className="flex items-center gap-1.5 px-3 py-1 bg-white text-stone-900 dark:bg-stone-900 dark:text-white rounded-full text-xs font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Create Collection</span>
        </button>

        <button
          type="button"
          onClick={onClearSelection}
          className="p-1 text-stone-400 hover:text-white dark:hover:text-stone-900 transition-colors cursor-pointer"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
